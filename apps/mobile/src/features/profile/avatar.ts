import type { NativeUpload } from '../../infrastructure/api/client.ts';
import { ApiError, invalidResponse } from '../../infrastructure/api/errors.ts';
import { isUuid } from '../../infrastructure/auth/credential-record.ts';
import { inspectBytes } from '../cards/attachments/policy.ts';
import type { AvatarApi } from './avatar-api.ts';
import { date, exact, object } from './model.ts';

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const MAX_PRIVATE_AVATAR_BYTES = 1024 * 1024;
export type AvatarMime = 'image/png' | 'image/jpeg' | 'image/webp';
export type Photo = {
  uri: string;
  filename: string;
  contentType: AvatarMime;
  fileSize: number;
  dispose(): void;
};
export type AvatarIntent = {
  uploadId: string;
  expiresAt: string;
  upload: {
    kind: 's3' | 'memory';
    url: string;
    fields: Record<string, string>;
  };
};
export function avatarDeclaration(mime: unknown, size: unknown) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime as string))
    throw new ApiError('http', {
      status: 415,
      code: 'AVATAR_MIME_MISMATCH',
      requestStarted: false,
    });
  if (
    !Number.isSafeInteger(size) ||
    (size as number) < 1 ||
    (size as number) > MAX_AVATAR_BYTES
  )
    throw new ApiError('http', {
      status: 413,
      code: 'AVATAR_TOO_LARGE',
      requestStarted: false,
    });
  return {
    contentType: mime as AvatarMime,
    fileSize: size as number,
    filename:
      mime === 'image/png'
        ? 'photo.png'
        : mime === 'image/jpeg'
          ? 'photo.jpg'
          : 'photo.webp',
  };
}
export function inspectAvatar(
  bytes: Uint8Array,
  mime: AvatarMime,
  size: number,
) {
  avatarDeclaration(mime, size);
  if (bytes.length !== size)
    throw new ApiError('http', {
      status: 415,
      code: 'AVATAR_MIME_MISMATCH',
      requestStarted: false,
    });
  try {
    inspectBytes(bytes, mime);
  } catch {
    throw new ApiError('http', {
      status: 422,
      code: 'AVATAR_INVALID_IMAGE',
      requestStarted: false,
    });
  }
}
export function decodeAvatarIntent(value: unknown): AvatarIntent {
  const v = object(value);
  exact(v, ['uploadId', 'expiresAt', 'upload']);
  if (!isUuid(v.uploadId) || !date(v.expiresAt)) throw invalidResponse(201);
  const u = object(v.upload);
  exact(u, ['kind', 'url', 'fields']);
  if (
    !['s3', 'memory'].includes(u.kind as string) ||
    typeof u.url !== 'string' ||
    u.url.length > 4096 ||
    /[\s\\\p{Cc}]/u.test(u.url)
  )
    throw invalidResponse(201);
  const fields = object(u.fields);
  if (
    Object.keys(fields).length > 32 ||
    Object.entries(fields).some(
      ([key, value]) =>
        !key ||
        /[\r\n"]/.test(key) ||
        ['file', '__proto__', 'constructor', 'prototype'].includes(
          key.toLowerCase(),
        ) ||
        typeof value !== 'string' ||
        value.length > 16384,
    )
  )
    throw invalidResponse(201);
  if (u.kind === 'memory') {
    if (
      u.url !== `/users/me/avatar/uploads/${v.uploadId}/file` ||
      Object.keys(fields).length
    )
      throw invalidResponse(201);
  } else {
    let url: URL;
    try {
      url = new URL(u.url);
    } catch {
      throw invalidResponse(201);
    }
    // Current backend uses AWS S3 with no custom endpoint. Never send bytes to arbitrary HTTPS hosts.
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.search ||
      !/^(?:[a-z0-9][a-z0-9.-]*\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com(?:\.cn)?$/.test(
        url.hostname,
      )
    )
      throw invalidResponse(201);
  }
  return {
    uploadId: v.uploadId,
    expiresAt: v.expiresAt,
    upload: {
      kind: u.kind as 's3' | 'memory',
      url: u.url,
      fields: { ...fields } as Record<string, string>,
    },
  };
}
export type AvatarTransferPorts = {
  now(): number;
  multipart(file: Photo, fields: Record<string, string>): NativeUpload;
  externalFetch: typeof fetch;
};
export async function transferAvatar(
  api: AvatarApi,
  candidate: AvatarIntent,
  file: Photo,
  ports: AvatarTransferPorts,
  signal: AbortSignal,
  check: () => void,
) {
  check();
  const intent = decodeAvatarIntent(candidate);
  const remaining = Date.parse(intent.expiresAt) - ports.now();
  if (remaining <= 0)
    throw new ApiError('http', {
      status: 409,
      code: 'AVATAR_UPLOAD_EXPIRED',
      requestStarted: false,
    });
  const timeoutMs = Math.min(60_000, remaining);
  const upload = ports.multipart(file, intent.upload.fields);
  if (intent.upload.kind === 'memory') {
    await api.memory(intent.uploadId, upload, signal, timeoutMs);
  } else {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
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
            const response = await ports.externalFetch(intent.upload.url, {
              method: 'POST',
              body: upload.createBody(),
              signal: controller.signal,
              credentials: 'omit',
              redirect: 'error',
              cache: 'no-store',
            });
            if (controller.signal.aborted)
              throw new ApiError(timedOut ? 'timeout' : 'aborted');
            if (![201, 204].includes(response.status))
              throw new ApiError('http', {
                status: response.status,
                code: 'AVATAR_TRANSFER_FAILED',
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
