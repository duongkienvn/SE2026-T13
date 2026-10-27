import { ApiError, apiRequest } from '../../lib/api-client';
import { env } from '../../lib/env';
import type { User } from './types';

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const isManagedAvatar = (url: string) =>
  /^\/users\/[0-9a-f-]{36}\/avatar\/[0-9a-f-]{36}$/i.test(url);

export interface AvatarIntent {
  uploadId: string;
  expiresAt: string;
  upload: {
    kind: 's3' | 'memory';
    url: string;
    fields: Record<string, string>;
  };
}
export function requestAvatarUpload(
  token: string,
  file: File,
  expectedRevision: number,
  signal?: AbortSignal,
) {
  return apiRequest<AvatarIntent>('/users/me/avatar/uploads', {
    method: 'POST',
    accessToken: token,
    body: { contentType: file.type, fileSize: file.size, expectedRevision },
    signal,
  });
}
export function completeAvatarUpload(
  token: string,
  id: string,
  signal?: AbortSignal,
) {
  return apiRequest<User>(
    `/users/me/avatar/uploads/${encodeURIComponent(id)}/complete`,
    { method: 'POST', accessToken: token, signal },
  );
}
export function removeAvatar(
  token: string,
  expectedRevision: number,
  signal?: AbortSignal,
) {
  return apiRequest<User>('/users/me/avatar', {
    method: 'DELETE',
    accessToken: token,
    body: { expectedRevision },
    signal,
  });
}

async function rawRequest(
  url: string,
  options: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Could not transfer the photo. Check your connection and try again.',
    );
  }
  if (!response.ok) {
    let code = 'AVATAR_TRANSFER_FAILED',
      message = 'Could not transfer the photo. Choose it again and retry.';
    // S3 XML/HTML is never rendered or logged. Only our JSON error envelope is used.
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

export async function transferAvatar(
  intent: AvatarIntent,
  file: File,
  signal: AbortSignal,
  localToken?: string,
): Promise<void> {
  const body = new FormData();
  for (const [key, value] of Object.entries(intent.upload.fields))
    body.append(key, value);
  body.append('file', file); // S3 requires the file field last.
  if (intent.upload.kind === 'memory') {
    if (
      !/^\/users\/me\/avatar\/uploads\/[0-9a-f-]{36}\/file$/i.test(
        intent.upload.url,
      ) ||
      !localToken
    )
      throw new Error('Invalid local upload target.');
    await rawRequest(`${env.apiBaseUrl}${intent.upload.url}`, {
      method: 'POST',
      body,
      signal,
      headers: { Authorization: `Bearer ${localToken}` },
    });
  } else {
    const url = new URL(intent.upload.url);
    if (url.protocol !== 'https:')
      throw new Error('Invalid photo upload target.');
    await rawRequest(url.href, {
      method: 'POST',
      body,
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  }
}

export async function readAvatar(
  token: string,
  path: string,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!isManagedAvatar(path)) throw new Error('Invalid photo path.');
  const response = await rawRequest(`${env.apiBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'image/webp' },
    signal,
    cache: 'no-store',
  });
  if (!response.headers.get('Content-Type')?.startsWith('image/webp'))
    throw new ApiError(502, 'INVALID_RESPONSE', 'Photo unavailable.');
  return response.blob();
}
