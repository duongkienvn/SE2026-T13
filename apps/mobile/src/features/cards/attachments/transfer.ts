import type { CreateAttachmentUpload } from '@kanban/shared';
import type { NativeUpload } from '../../../infrastructure/api/client.ts';
import {
  ApiError,
  invalidResponse,
} from '../../../infrastructure/api/errors.ts';
import type { Attachment, AttachmentApi, UploadIntent } from './api.ts';
import { attachmentPath } from './api.ts';
import { inspectBytes, isFileMime, rejectFile } from './policy.ts';

export type SelectedFile = CreateAttachmentUpload & {
  uri: string;
  dispose: () => void;
};
export type UploadPhase =
  | 'selecting'
  | 'intent'
  | 'uploading'
  | 'verifying'
  | 'complete'
  | 'failed'
  | 'canceled';
export type UploadJob = {
  file: SelectedFile;
  key: string;
  uploadId?: string;
  intentExpiresAt?: string;
  transferAttempted: boolean;
};
export type TransferPorts = {
  multipart: (
    file: SelectedFile,
    fields: Record<string, string>,
  ) => NativeUpload;
  externalFetch: typeof fetch;
  now: () => number;
};
function verifiedFile(row: Attachment, id: string) {
  if (row.kind !== 'FILE' || row.id !== id || row.state !== 'ACTIVE')
    throw invalidResponse(200);
  return row;
}

/** Exact granted target only; opaque fields are never returned to UI/cache/logs. */
export async function transferAttachment(
  api: AttachmentApi,
  boardId: string,
  cardId: string,
  intent: UploadIntent,
  file: SelectedFile,
  ports: TransferPorts,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const grant = intent.upload;
  if (!grant || intent.state !== 'PENDING') throw invalidResponse(201);
  const remaining =
    Math.min(Date.parse(intent.expiresAt), Date.parse(grant.expiresAt)) -
    ports.now();
  if (remaining <= 0)
    throw new ApiError('http', {
      status: 409,
      code:
        Date.parse(intent.expiresAt) <= ports.now()
          ? 'ATTACHMENT_UPLOAD_EXPIRED'
          : 'ATTACHMENT_TRANSFER_EXPIRED',
    });
  const timeoutMs = Math.min(120_000, remaining);
  const body = ports.multipart(file, grant.fields);
  if (grant.kind === 'memory') {
    const expected = `/api${attachmentPath(boardId, cardId)}/uploads/${encodeURIComponent(intent.uploadId)}/file`;
    if (grant.url !== expected || Object.keys(grant.fields).length)
      throw invalidResponse(201);
    await api.memory(intent.uploadId, body, signal, timeoutMs);
  } else {
    let url: URL;
    try {
      url = new URL(grant.url);
    } catch {
      throw invalidResponse(201);
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      /[\p{Cc}\\]/u.test(grant.url)
    )
      throw invalidResponse(201);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, timeoutMs);
    if (signal.aborted) abort();
    try {
      await new Promise<void>((resolve, reject) => {
        const canceled = () =>
          reject(new ApiError(timedOut ? 'timeout' : 'aborted'));
        controller.signal.addEventListener('abort', canceled, { once: true });
        if (controller.signal.aborted) {
          canceled();
          return;
        }
        Promise.resolve()
          .then(async () => {
            check();
            const response = await ports.externalFetch(grant.url, {
              method: 'POST',
              body: body.createBody(),
              signal: controller.signal,
              credentials: 'omit',
              redirect: 'error',
              cache: 'no-store',
              // No bearer/cookie/manual multipart boundary, including on retry.
            });
            if (controller.signal.aborted)
              throw new ApiError(timedOut ? 'timeout' : 'aborted');
            if (![200, 201, 204].includes(response.status))
              throw new ApiError('http', {
                status: response.status,
                code: 'ATTACHMENT_TRANSFER_FAILED',
              });
            await response.body?.cancel().catch(() => undefined);
            check();
          })
          .then(resolve, (error) =>
            reject(error instanceof ApiError ? error : new ApiError('network')),
          )
          .finally(() =>
            controller.signal.removeEventListener('abort', canceled),
          );
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  check();
}

/** Retry first reconciles uncertain bytes/completion; it never creates a new intent key. */
export async function runUpload(
  api: AttachmentApi,
  boardId: string,
  cardId: string,
  job: UploadJob,
  ports: TransferPorts,
  signal: AbortSignal,
  check: () => void,
  phase: (value: UploadPhase) => void,
): Promise<Attachment> {
  check();
  if (job.uploadId && job.transferAttempted) {
    phase('verifying');
    try {
      const active = await api.complete(job.uploadId, signal);
      check();
      return verifiedFile(active, job.uploadId);
    } catch (error) {
      check();
      if (
        !(error instanceof ApiError) ||
        error.code !== 'ATTACHMENT_NOT_UPLOADED'
      )
        throw error;
    }
  }
  phase('intent');
  const intent = await api.intent(job.file, job.key, signal);
  job.uploadId = intent.uploadId;
  job.intentExpiresAt = intent.expiresAt;
  try {
    check();
  } catch (error) {
    // Cancellation may race an acknowledged reservation. Never orphan a known
    // pending intent; the captured session still fences this best-effort delete.
    if (intent.state === 'PENDING')
      void api.cancel(intent.uploadId).catch(() => undefined);
    throw error;
  }
  if (intent.state === 'ACTIVE') {
    const active = await api.get(intent.uploadId, signal);
    check();
    return verifiedFile(active, intent.uploadId);
  }
  phase('uploading');
  job.transferAttempted = true;
  await transferAttachment(
    api,
    boardId,
    cardId,
    intent,
    job.file,
    ports,
    signal,
    check,
  );
  phase('verifying');
  const result = await api.complete(intent.uploadId, signal);
  check();
  return verifiedFile(result, intent.uploadId);
}

export async function downloadPrivateFile(
  api: AttachmentApi,
  row: Attachment,
  signal: AbortSignal,
  check: () => void,
  save: (
    bytes: Uint8Array,
    row: Attachment,
  ) => { uri: string; dispose: () => void },
  share: (uri: string, mime: string) => Promise<void>,
) {
  check();
  if (row.kind !== 'FILE' || !isFileMime(row.mimeType))
    rejectFile('Select a private file.');
  const result = await api.download(row, signal);
  check();
  const bytes = new Uint8Array(result.bytes);
  if (
    result.contentType !== row.mimeType ||
    result.contentLength !== row.byteSize ||
    bytes.byteLength !== row.byteSize
  )
    throw invalidResponse(200);
  inspectBytes(bytes, row.mimeType);
  check();
  let temporary: ReturnType<typeof save> | undefined;
  const cleanup = () => temporary?.dispose();
  signal.addEventListener('abort', cleanup, { once: true });
  try {
    temporary = save(bytes, row);
    check();
    await share(temporary.uri, row.mimeType);
    check();
  } finally {
    signal.removeEventListener('abort', cleanup);
    temporary?.dispose();
  }
}
