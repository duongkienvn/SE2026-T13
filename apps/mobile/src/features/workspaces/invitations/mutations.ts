import { onlineManager } from '@tanstack/react-query';
import { ApiError } from '../../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';
import type { ResourceId } from '../../../navigation/routes.ts';
import { maxWorkspacePage } from '../api.ts';
import { isWorkspaceDenied } from '../queries.ts';
import { uncertainWorkspaceWrite } from '../membership/mutations.ts';
import { recheckWorkspaceAccess } from '../membership/queries.ts';
import { createInvitationAdminApi, invitationKey } from './api.ts';
import { canManageInvitations, clearInvitationHistory } from './queries.ts';

export type IssuanceReview = { email: string; newestBefore: string | null };

export const issuanceReviewKey = (identity: SessionIdentity, id: ResourceId) =>
  [...invitationKey(identity, id), 'issuance-review'] as const;

export function issueInvitation(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
  email: string,
  signal: AbortSignal,
) {
  const key = issuanceReviewKey(identity, id);
  return writeInvitation(data, identity, id, signal, async (api) => {
    const baseline = await api
      .history(1, undefined, signal, 1)
      .catch((error: unknown) => {
        // A failed baseline GET never issued an invitation.
        if (!(error instanceof ApiError)) throw error;
        throw new ApiError(error.kind, {
          status: error.status,
          code: error.code,
          retryAfterMs: error.retryAfterMs,
        });
      });
    data.assertCurrent(identity);
    if (signal.aborted) throw new ApiError('aborted');
    if (!baseline.data[0] && baseline.meta.total > 0)
      throw new ApiError('invalid-response');
    if (data.queryClient.getQueryData(key))
      throw new ApiError('http', { status: 409 });
    const attempt = data.queryClient.setQueryData<IssuanceReview>(key, {
      email,
      newestBefore: baseline.data[0]?.createdAt ?? null,
    });
    const clearAttempt = () => {
      if (data.queryClient.getQueryData(key) === attempt)
        data.queryClient.setQueryData(key, null);
    };
    try {
      const row = await api.issue(email, signal);
      data.assertCurrent(identity);
      clearAttempt();
      return row;
    } catch (error) {
      if (
        !uncertainWorkspaceWrite(error) &&
        sameIdentity(identity, data.getIdentity())
      )
        clearAttempt();
      throw error;
    }
  });
}

export async function findNewInvitation(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
  attempt: IssuanceReview,
  signal: AbortSignal,
) {
  const api = createInvitationAdminApi(data.api, identity, id);
  let lastPage = maxWorkspacePage;
  for (let page = 1; page <= lastPage; page++) {
    const { data: rows, meta } = await api.history(
      page,
      undefined,
      signal,
      100,
    );
    lastPage = Math.min(lastPage, meta.totalPages);
    // History is newest-first. Equal timestamps provide no evidence of a new row.
    for (const row of rows) {
      if (attempt.newestBefore && row.createdAt <= attempt.newestBefore) return;
      if (row.email === attempt.email && row.invitedById === identity.userId)
        return row;
    }
  }
}

export async function writeInvitation<T>(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
  signal: AbortSignal,
  write: (api: ReturnType<typeof createInvitationAdminApi>) => Promise<T>,
) {
  const key = invitationKey(identity, id);
  data.assertCurrent(identity);
  if (!onlineManager.isOnline()) throw new ApiError('offline');
  try {
    const workspace = await recheckWorkspaceAccess(data, identity, id);
    data.assertCurrent(identity);
    if (signal.aborted) throw new ApiError('aborted');
    if (!canManageInvitations(workspace))
      throw new ApiError('http', { status: 403 });
    const result = await write(
      createInvitationAdminApi(data.api, identity, id),
    );
    data.assertCurrent(identity);
    data.cancelResourceRequests(key);
    void data.invalidate(identity, [key]).catch(() => undefined);
    return result;
  } catch (error) {
    if (!signal.aborted && sameIdentity(identity, data.getIdentity())) {
      if (isWorkspaceDenied(error)) {
        clearInvitationHistory(data, identity, id);
        void recheckWorkspaceAccess(data, identity, id).catch(() => undefined);
      } else if (
        (error instanceof ApiError && error.status === 409) ||
        uncertainWorkspaceWrite(error)
      ) {
        void data.invalidate(identity, [key]).catch(() => undefined);
      }
    }
    throw invitationRetryError(error);
  }
}

export function invitationRetryError(error: unknown) {
  return error instanceof ApiError &&
    error.status === 429 &&
    error.retryAfterMs === undefined
    ? new ApiError('http', { status: 429, retryAfterMs: 60_000 })
    : error;
}

export function adminInvitationError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 400)
      return 'The server rejected this request. Check the email or refresh invitation history.';
    if (error.status === 409)
      return 'The invitation status changed or the recipient is already a member. Check the latest history.';
    if (error.status === 429)
      return 'Too many invitation requests. Wait before trying again.';
    if (error.kind === 'offline')
      return 'You’re offline. Reconnect to manage invitations.';
  }
  return 'Couldn’t complete the invitation request. Try again.';
}
