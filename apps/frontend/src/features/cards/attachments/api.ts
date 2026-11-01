import type {
  CardAttachmentMetadata,
  CardAttachmentUploadIntent,
  CreateAttachmentUpload,
  UpdateUrlAttachment,
} from '@kanban/shared';
import { ApiError, apiRequest, apiRequestPage } from '../../../lib/api-client';
import { env } from '../../../lib/env';

export type Attachment = CardAttachmentMetadata;

/** V1 server policy (P3-06), mirrored for early, friendly checks only. */
export const ATTACHMENT_POLICY = {
  maximumFileBytes: 10 * 1024 * 1024,
  maximumCardAttachments: 20,
  types: {
    'image/png': ['.png'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/webp': ['.webp'],
    'application/pdf': ['.pdf'],
    'text/plain': ['.txt'],
  } as Record<string, string[]>,
};
export const ACCEPTED_FILES = Object.entries(ATTACHMENT_POLICY.types)
  .flatMap(([type, extensions]) => [type, ...extensions])
  .join(',');
/** Only verified raster images are shown inline; documents are downloads. */
export const PREVIEWABLE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const ATTACHMENTS_PAGE_SIZE = 5;

const id = encodeURIComponent;
const attachmentsPath = (boardId: string, cardId: string) =>
  `/boards/${id(boardId)}/cards/${id(cardId)}/attachments`;

export function listAttachments(
  token: string,
  boardId: string,
  cardId: string,
  page: number,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(ATTACHMENTS_PAGE_SIZE),
  });
  return apiRequestPage<Attachment>(
    `${attachmentsPath(boardId, cardId)}?${query}`,
    { accessToken: token, signal },
  );
}

export function addUrlAttachment(
  token: string,
  boardId: string,
  cardId: string,
  input: { url: string; displayName?: string },
  idempotencyKey: string,
) {
  return apiRequest<Attachment>(attachmentsPath(boardId, cardId), {
    method: 'POST',
    body: { kind: 'URL', ...input },
    accessToken: token,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function updateAttachment(
  token: string,
  boardId: string,
  cardId: string,
  attachmentId: string,
  input: UpdateUrlAttachment,
) {
  return apiRequest<Attachment>(
    `${attachmentsPath(boardId, cardId)}/${id(attachmentId)}`,
    { method: 'PATCH', body: input, accessToken: token },
  );
}

export function removeAttachment(
  token: string,
  boardId: string,
  cardId: string,
  attachmentId: string,
  expectedRevision: number,
) {
  const query = new URLSearchParams({
    expectedRevision: String(expectedRevision),
  });
  return apiRequest<void>(
    `${attachmentsPath(boardId, cardId)}/${id(attachmentId)}?${query}`,
    { method: 'DELETE', accessToken: token },
  );
}

export function createUpload(
  token: string,
  boardId: string,
  cardId: string,
  input: CreateAttachmentUpload,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return apiRequest<CardAttachmentUploadIntent>(
    `${attachmentsPath(boardId, cardId)}/uploads`,
    {
      method: 'POST',
      body: input,
      accessToken: token,
      headers: { 'Idempotency-Key': idempotencyKey },
      signal,
    },
  );
}

export function completeUpload(
  token: string,
  boardId: string,
  cardId: string,
  uploadId: string,
  signal?: AbortSignal,
) {
  return apiRequest<Attachment>(
    `${attachmentsPath(boardId, cardId)}/uploads/${id(uploadId)}/complete`,
    { method: 'POST', body: {}, accessToken: token, signal },
  );
}

export function cancelUpload(
  token: string,
  boardId: string,
  cardId: string,
  uploadId: string,
) {
  return apiRequest<void>(
    `${attachmentsPath(boardId, cardId)}/uploads/${id(uploadId)}`,
    { method: 'DELETE', accessToken: token },
  );
}

async function rawRequest(url: string, options: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection and try again.',
    );
  }
  if (!response.ok) {
    let code = 'ATTACHMENT_TRANSFER_FAILED',
      message = 'The file could not be transferred.';
    // Storage XML/HTML is never shown or logged; only our JSON envelope is read.
    if (response.headers.get('Content-Type')?.includes('application/json')) {
      const body: unknown = await response.json().catch(() => null);
      if (
        body &&
        typeof body === 'object' &&
        'code' in body &&
        typeof body.code === 'string' &&
        'message' in body &&
        typeof body.message === 'string'
      ) {
        code = body.code;
        message = body.message;
      }
    }
    throw new ApiError(response.status, code, message);
  }
  return response;
}

/**
 * Sends the bytes exactly as the intent says: S3 gets every returned field and
 * the file last, over HTTPS, without our token or cookies; the dev/test memory
 * target is an API path that needs the token.
 */
export async function transferFile(
  intent: CardAttachmentUploadIntent,
  file: File,
  boardId: string,
  cardId: string,
  token: string,
  signal: AbortSignal,
): Promise<void> {
  const upload = intent.upload;
  if (!upload) return; // An already completed replay has nothing to send.
  const body = new FormData();
  for (const [key, value] of Object.entries(upload.fields))
    body.append(key, value);
  body.append('file', file); // S3 requires the file field last.
  if (upload.kind === 'memory') {
    // An API-relative path such as `/api/boards/…/uploads/:id/file`.
    const api = new URL(env.apiBaseUrl, window.location.origin);
    const target = new URL(upload.url, api);
    const expected = `${attachmentsPath(boardId, cardId)}/uploads/${id(intent.uploadId)}/file`;
    if (
      !upload.url.startsWith('/') ||
      target.origin !== api.origin ||
      !target.pathname.toLowerCase().endsWith(expected.toLowerCase())
    )
      throw new Error('Invalid local upload target.');
    await rawRequest(target.href, {
      method: 'POST',
      body,
      signal,
      headers: { Authorization: `Bearer ${token}` },
    });
    return;
  }
  const url = new URL(upload.url);
  if (url.protocol !== 'https:') throw new Error('Invalid upload target.');
  await rawRequest(url.href, {
    method: 'POST',
    body,
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
}

/** The verified bytes, streamed by the API with the user's token. */
export async function readAttachmentFile(
  token: string,
  attachment: Pick<Attachment, 'id' | 'boardId' | 'cardId'>,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await rawRequest(
    `${env.apiBaseUrl}${attachmentsPath(attachment.boardId, attachment.cardId)}/${id(attachment.id)}/file`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal,
      cache: 'no-store',
    },
  );
  return response.blob();
}
