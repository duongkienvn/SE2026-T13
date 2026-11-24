import type { DeleteAccountRequest } from '@kanban/shared';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import { ApiError } from '../../infrastructure/api/errors.ts';
import { createSecurityApi } from '../security/api.ts';
export function deletionBody(input: unknown): DeleteAccountRequest {
  const fail = () => {
    throw new ApiError('http', { status: 400, requestStarted: false });
  };
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return fail();
  const row = input as Record<string, unknown>;
  if (
    row.confirmation !== 'DELETE' ||
    Object.keys(row).some(
      (k) =>
        !['confirmation', 'currentPassword', 'googleCredential'].includes(k),
    ) ||
    'currentPassword' in row === 'googleCredential' in row
  )
    return fail();
  const key = 'currentPassword' in row ? 'currentPassword' : 'googleCredential',
    value = row[key];
  if (
    typeof value !== 'string' ||
    !value ||
    (key === 'currentPassword'
      ? Array.from(value).length > 128
      : value.length > 8192)
  )
    return fail();
  return key === 'currentPassword'
    ? { confirmation: 'DELETE', currentPassword: value }
    : { confirmation: 'DELETE', googleCredential: value };
}
export function createDeletionApi(
  http: SessionHttpClient,
  identity: SessionIdentity,
) {
  return {
    providers: createSecurityApi(http, identity).providers,
    async delete(input: DeleteAccountRequest, signal: AbortSignal) {
      try {
        await http.empty('/users/me', {
          identity,
          signal,
          method: 'DELETE',
          body: deletionBody(input),
          retries: 0,
          expectedStatus: 204,
          timeoutMs: 45000,
        });
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status === 409 &&
          error.code === 'ACCOUNT_DELETION_BLOCKED' &&
          !error.blockers.length
        )
          throw new ApiError('invalid-response', {
            status: 409,
            requestStarted: error.requestStarted,
          });
        throw error;
      }
    },
  };
}
