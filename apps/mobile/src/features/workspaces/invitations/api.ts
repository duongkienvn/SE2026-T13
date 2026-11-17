import { WorkspaceRole } from '@kanban/shared';
import { isProof } from '../../auth/validation.ts';
import {
  ApiError,
  invalidResponse,
} from '../../../infrastructure/api/errors.ts';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import { requirePage } from '../../../infrastructure/query/pagination.ts';
import type { ResourceId } from '../../../navigation/routes.ts';
import { maxWorkspacePage, workspacePageLimit } from '../api.ts';
import { workspaceId } from '../decoder.ts';
import { decodeMember } from '../membership/decoder.ts';
import {
  decodeInvitation,
  invitationEmail,
  invitationStatuses,
  type InvitationStatus,
} from './decoder.ts';

export const invitationKey = (identity: SessionIdentity, id: ResourceId) =>
  [...queryKeys.workspace(identity, id), 'invitations'] as const;

export function createInvitationAdminApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
  id: ResourceId,
) {
  if (workspaceId(id) !== id) throw new ApiError('configuration');
  const path = '/workspaces/' + id + '/invitations';
  const options = (signal: AbortSignal) => ({
    identity,
    signal,
    retries: 0 as const,
    resourceKey: invitationKey(identity, id),
  });
  const decode = (value: unknown) => {
    const row = decodeInvitation(value);
    if (row.workspaceId !== id) throw invalidResponse(200);
    return row;
  };
  return {
    issue(email: string, signal: AbortSignal) {
      const normalized = invitationEmail(email);
      if (!normalized) throw new ApiError('configuration');
      return api.json(
        path,
        (value) => {
          const row = decode(value);
          if (row.email !== normalized) throw invalidResponse(202);
          return row;
        },
        {
          ...options(signal),
          expectedStatus: 202,
          method: 'POST',
          body: { email: normalized, role: WorkspaceRole.MEMBER },
        },
      );
    },
    async history(
      page: number,
      status: InvitationStatus | undefined,
      signal: AbortSignal,
      limit = workspacePageLimit,
    ) {
      if (
        !Number.isInteger(page) ||
        page < 1 ||
        page > maxWorkspacePage ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (status !== undefined && !invitationStatuses.includes(status))
      )
        throw new ApiError('configuration');
      const result = requirePage(
        await api.envelope(
          path,
          (value) => {
            if (!Array.isArray(value) || value.length > limit)
              throw invalidResponse(200);
            const rows = value.map(decode);
            if (
              new Set(rows.map(({ id }) => id)).size !== rows.length ||
              (status && rows.some((row) => row.status !== status))
            )
              throw invalidResponse(200);
            return rows;
          },
          {
            ...options(signal),
            expectedStatus: 200,
            query: { page, limit, status },
          },
        ),
      );
      if (
        result.meta.page !== page ||
        result.meta.limit !== limit ||
        result.meta.totalPages !== Math.ceil(result.meta.total / limit)
      )
        throw invalidResponse(200);
      return result;
    },
    revoke(invitationId: ResourceId, signal: AbortSignal) {
      if (workspaceId(invitationId) !== invitationId)
        throw new ApiError('configuration');
      return api.empty(path + '/' + invitationId, {
        ...options(signal),
        method: 'DELETE',
      });
    },
  };
}

export function createInvitationRecipientApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
) {
  function options(proof: string, signal: AbortSignal) {
    if (!isProof(proof)) throw new ApiError('configuration');
    return {
      identity,
      signal,
      method: 'POST' as const,
      body: { proof },
      retries: 0 as const,
    };
  }
  return {
    accept(proof: string, signal: AbortSignal) {
      return api.json(
        '/workspace-invitations/accept',
        (value) => {
          const member = decodeMember(value);
          if (member.userId !== identity.userId) throw invalidResponse(200);
          return member;
        },
        { ...options(proof, signal), expectedStatus: 200 },
      );
    },
    decline(proof: string, signal: AbortSignal) {
      return api.empty(
        '/workspace-invitations/decline',
        options(proof, signal),
      );
    },
  };
}
