import type { NativeUpload } from '../../infrastructure/api/client.ts';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import { invalidResponse } from '../../infrastructure/api/errors.ts';
import { isUuid } from '../../infrastructure/auth/credential-record.ts';
import { createProfileApi } from './api.ts';
import {
  avatarDeclaration,
  decodeAvatarIntent,
  MAX_PRIVATE_AVATAR_BYTES,
  type Photo,
} from './avatar.ts';
import { privateAvatarPath } from './model.ts';

const root = '/users/me/avatar';
function revision(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2147483646)
    throw invalidResponse(0);
  return value;
}
function uploadPath(id: string) {
  if (!isUuid(id)) throw invalidResponse(0);
  return `${root}/uploads/${id}`;
}
export function createAvatarApi(
  http: SessionHttpClient,
  identity: SessionIdentity,
) {
  const decode = createProfileApi(http, identity).decode;
  const options = (signal: AbortSignal) => ({
    identity,
    signal,
    retries: 0 as const,
  });
  return {
    intent: (
      file: Pick<Photo, 'contentType' | 'fileSize'>,
      expectedRevision: number,
      signal: AbortSignal,
    ) => {
      const { contentType, fileSize } = avatarDeclaration(
        file.contentType,
        file.fileSize,
      );
      return http.json(`${root}/uploads`, decodeAvatarIntent, {
        ...options(signal),
        method: 'POST',
        expectedStatus: 201,
        body: {
          contentType,
          fileSize,
          expectedRevision: revision(expectedRevision),
        },
      });
    },
    complete: (id: string, signal: AbortSignal) =>
      http.json(
        `${uploadPath(id)}/complete`,
        (value) => {
          const user = decode(value);
          if (
            user.avatarUrl !== `/users/${identity.userId}/avatar/${id}` ||
            user.avatarRevision < 1
          )
            throw invalidResponse(200);
          return user;
        },
        {
          ...options(signal),
          method: 'POST',
          expectedStatus: 200,
          timeoutMs: 45_000,
        },
      ),
    remove: (expectedRevision: number, signal: AbortSignal) =>
      http.json(
        root,
        (value) => {
          const user = decode(value);
          if (
            user.avatarUrl !== null ||
            user.avatarRevision <= expectedRevision
          )
            throw invalidResponse(200);
          return user;
        },
        {
          ...options(signal),
          method: 'DELETE',
          expectedStatus: 200,
          body: { expectedRevision: revision(expectedRevision) },
        },
      ),
    memory: (
      id: string,
      upload: NativeUpload,
      signal: AbortSignal,
      timeoutMs: number,
    ) =>
      http.empty(`${uploadPath(id)}/file`, {
        ...options(signal),
        method: 'POST',
        upload,
        timeoutMs,
      }),
    read: (path: string, signal: AbortSignal) => {
      if (!privateAvatarPath(path, identity.userId)) throw invalidResponse(0);
      return http.binary(path, ['image/webp'], {
        ...options(signal),
        maximumBytes: MAX_PRIVATE_AVATAR_BYTES,
        requireContentLength: true,
        expectedStatus: 200,
      });
    },
  };
}
export type AvatarApi = ReturnType<typeof createAvatarApi>;
