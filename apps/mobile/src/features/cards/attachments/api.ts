import type {
  CardAttachmentMetadata,
  CardAttachmentUploadIntent,
  CreateAttachmentUpload,
} from '@kanban/shared';
import type { PaginationMeta } from '@kanban/shared';
import type { NativeUpload } from '../../../infrastructure/api/client.ts';
import { invalidResponse } from '../../../infrastructure/api/errors.ts';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import { isUuid } from '../../../infrastructure/auth/credential-record.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import {
  displayName,
  fileDeclaration,
  httpsUrl,
  isFileMime,
  rejectFile,
  safeFilename,
  FILE_LIMIT,
} from './policy.ts';

export type Attachment = CardAttachmentMetadata;
export type UploadIntent = CardAttachmentUploadIntent;
export const PAGE_SIZE = 100;
export type AttachmentPage = { data: Attachment[]; meta: PaginationMeta };
export type AttachmentScope = {
  identity: SessionIdentity;
  boardId: string;
  cardId: string;
};
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw invalidResponse(200);
  return raw as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (!isUuid(value)) throw invalidResponse(200);
  return value.toLowerCase();
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw invalidResponse(200);
  return value;
}
export function decodeAttachment(
  raw: unknown,
  boardId: string,
  cardId: string,
): Attachment {
  const row = object(raw);
  if (
    uuid(row.boardId) !== boardId.toLowerCase() ||
    uuid(row.cardId) !== cardId.toLowerCase() ||
    row.state !== 'ACTIVE' ||
    !Number.isSafeInteger(row.revision) ||
    (row.revision as number) < 1 ||
    typeof row.displayName !== 'string'
  )
    throw invalidResponse(200);
  try {
    displayName(row.displayName);
  } catch {
    throw invalidResponse(200);
  }
  if (row.kind === 'URL') {
    try {
      if (typeof row.url !== 'string') throw new Error();
      httpsUrl(row.url);
    } catch {
      throw invalidResponse(200);
    }
    if (
      row.originalFilename !== null ||
      row.mimeType !== null ||
      row.byteSize !== null
    )
      throw invalidResponse(200);
  } else if (row.kind === 'FILE') {
    if (
      row.url !== null ||
      typeof row.originalFilename !== 'string' ||
      !isFileMime(row.mimeType) ||
      !Number.isSafeInteger(row.byteSize) ||
      (row.byteSize as number) < 1 ||
      (row.byteSize as number) > FILE_LIMIT
    )
      throw invalidResponse(200);
    try {
      fileDeclaration(
        row.originalFilename,
        row.mimeType,
        row.byteSize as number,
      );
    } catch {
      throw invalidResponse(200);
    }
  } else throw invalidResponse(200);
  return {
    id: uuid(row.id),
    boardId: uuid(row.boardId),
    cardId: uuid(row.cardId),
    uploaderId: uuid(row.uploaderId),
    kind: row.kind,
    state: 'ACTIVE',
    displayName: row.displayName,
    url: row.url as string | null,
    originalFilename: row.originalFilename as string | null,
    mimeType: row.mimeType as string | null,
    byteSize: row.byteSize as number | null,
    revision: row.revision as number,
    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),
  };
}
export function decodeIntent(raw: unknown): UploadIntent {
  const row = object(raw);
  const uploadId = uuid(row.uploadId),
    expiresAt = date(row.expiresAt);
  if (row.state === 'ACTIVE' && row.upload === null)
    return { uploadId, expiresAt, state: 'ACTIVE', upload: null };
  if (row.state !== 'PENDING') throw invalidResponse(201);
  const target = object(row.upload),
    fields = object(target.fields);
  if (
    !['memory', 's3'].includes(target.kind as string) ||
    typeof target.url !== 'string' ||
    Object.entries(fields).some(
      ([key, value]) =>
        !key || /[\r\n"]/.test(key) || typeof value !== 'string',
    ) ||
    Object.hasOwn(fields, 'file')
  )
    throw invalidResponse(201);
  return {
    uploadId,
    expiresAt,
    state: 'PENDING',
    upload: {
      kind: target.kind as 'memory' | 's3',
      url: target.url,
      fields: { ...fields } as Record<string, string>,
      expiresAt: date(target.expiresAt),
    },
  };
}
function key(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    rejectFile('A UUIDv4 operation key is required.');
  return { 'Idempotency-Key': value };
}
function revision(value: number) {
  if (!Number.isSafeInteger(value) || value < 1)
    rejectFile('Reload the attachment revision.');
  return value;
}
export function attachmentPath(boardId: string, cardId: string) {
  return `/boards/${encodeURIComponent(boardId)}/cards/${encodeURIComponent(cardId)}/attachments`;
}
export function createAttachmentApi(
  http: SessionHttpClient,
  scope: AttachmentScope,
) {
  const { identity, boardId, cardId } = scope;
  const base = attachmentPath(boardId, cardId);
  const options = (signal?: AbortSignal) => ({
    identity,
    resourceKey: queryKeys.attachments(identity, boardId, cardId),
    signal,
  });
  const decode = (raw: unknown) => decodeAttachment(raw, boardId, cardId);
  const decodeItem =
    (id: string, file = false) =>
    (raw: unknown) => {
      const row = decode(raw);
      if (row.id !== id.toLowerCase() || (file && row.kind !== 'FILE'))
        throw invalidResponse(200);
      return row;
    };
  const item = (id: string) => `${base}/${encodeURIComponent(id)}`;
  const upload = (id: string) => `${base}/uploads/${encodeURIComponent(id)}`;
  return {
    async list(page: number, signal?: AbortSignal): Promise<AttachmentPage> {
      if (!Number.isSafeInteger(page) || page < 1)
        rejectFile('Choose a valid page.');
      const result = await http.envelope(
        base,
        (raw) => {
          if (!Array.isArray(raw) || raw.length > PAGE_SIZE)
            throw invalidResponse(200);
          const rows = raw.map(decode);
          if (new Set(rows.map(({ id }) => id)).size !== rows.length)
            throw invalidResponse(200);
          return rows;
        },
        {
          ...options(signal),
          query: { page, limit: PAGE_SIZE },
          expectedStatus: 200,
        },
      );
      const meta = result.meta;
      if (
        !meta ||
        !('page' in meta) ||
        meta.page !== page ||
        meta.limit !== PAGE_SIZE ||
        meta.totalPages !== Math.ceil(meta.total / PAGE_SIZE) ||
        result.data.length !==
          Math.min(PAGE_SIZE, Math.max(0, meta.total - (page - 1) * PAGE_SIZE))
      )
        throw invalidResponse(200);
      return { data: result.data, meta };
    },
    get: (id: string, signal?: AbortSignal) =>
      http.json(item(id), decodeItem(id), {
        ...options(signal),
        expectedStatus: 200,
      }),
    create: (
      input: { url: string; displayName?: string },
      idempotencyKey: string,
      signal?: AbortSignal,
    ) =>
      http.json(base, decode, {
        ...options(signal),
        method: 'POST',
        expectedStatus: 201,
        headers: key(idempotencyKey),
        body: {
          kind: 'URL',
          url: httpsUrl(input.url),
          ...(input.displayName === undefined
            ? {}
            : { displayName: displayName(input.displayName) }),
        },
      }),
    edit: (
      row: Attachment,
      input: { url?: string; displayName?: string },
      signal?: AbortSignal,
    ) => {
      if (row.kind === 'FILE' && input.url !== undefined)
        rejectFile('File URLs cannot be edited.');
      if (input.url === undefined && input.displayName === undefined)
        rejectFile('Enter a URL or display name.');
      return http.json(item(row.id), decodeItem(row.id), {
        ...options(signal),
        method: 'PATCH',
        expectedStatus: 200,
        body: {
          expectedRevision: revision(row.revision),
          ...(input.url === undefined ? {} : { url: httpsUrl(input.url) }),
          ...(input.displayName === undefined
            ? {}
            : { displayName: displayName(input.displayName) }),
        },
      });
    },
    remove: (row: Attachment, signal?: AbortSignal) =>
      http.empty(item(row.id), {
        ...options(signal),
        method: 'DELETE',
        query: { expectedRevision: revision(row.revision) },
      }),
    intent: (
      input: CreateAttachmentUpload,
      idempotencyKey: string,
      signal?: AbortSignal,
    ) =>
      http.json(`${base}/uploads`, decodeIntent, {
        ...options(signal),
        method: 'POST',
        expectedStatus: 201,
        headers: key(idempotencyKey),
        body: {
          ...fileDeclaration(input.filename, input.contentType, input.fileSize),
          ...(input.displayName === undefined
            ? {}
            : { displayName: displayName(input.displayName) }),
        },
      }),
    complete: (id: string, signal?: AbortSignal) =>
      http.json(`${upload(id)}/complete`, decodeItem(id, true), {
        ...options(signal),
        method: 'POST',
        body: {},
        expectedStatus: 200,
        timeoutMs: 120_000,
      }),
    cancel: (id: string) =>
      http.empty(upload(id), {
        ...options(),
        method: 'DELETE',
        timeoutMs: 15_000,
      }),
    memory: (
      id: string,
      body: NativeUpload,
      signal: AbortSignal,
      timeoutMs: number,
    ) =>
      http.empty(`${upload(id)}/file`, {
        ...options(signal),
        method: 'POST',
        upload: body,
        timeoutMs,
      }),
    download: (row: Attachment, signal: AbortSignal) => {
      if (row.kind !== 'FILE' || !isFileMime(row.mimeType))
        rejectFile('Select a private file.');
      safeFilename(row.originalFilename!);
      return http.binary(`${item(row.id)}/file`, [row.mimeType!], {
        ...options(signal),
        expectedStatus: 200,
        maximumBytes: FILE_LIMIT,
        requireContentLength: true,
        timeoutMs: 120_000,
        retries: 0,
      });
    },
  };
}
export type AttachmentApi = ReturnType<typeof createAttachmentApi>;
