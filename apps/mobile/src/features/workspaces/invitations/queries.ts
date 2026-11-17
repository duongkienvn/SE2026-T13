import { queryOptions } from '@tanstack/react-query';
import type { SessionIdentity } from '../../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';
import type { ResourceId } from '../../../navigation/routes.ts';
import { isWorkspaceDenied } from '../queries.ts';
import {
  canManageWorkspaceMembers,
  recheckWorkspaceAccess,
} from '../membership/queries.ts';
import { createInvitationAdminApi, invitationKey } from './api.ts';
import type { InvitationStatus } from './decoder.ts';

export const canManageInvitations = canManageWorkspaceMembers;

export function invitationHistoryOptions(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
  page: number,
  status?: InvitationStatus,
) {
  return queryOptions({
    queryKey: [...invitationKey(identity, id), status, page] as const,
    retry: false,
    async queryFn({ signal }) {
      try {
        return await createInvitationAdminApi(data.api, identity, id).history(
          page,
          status,
          signal,
        );
      } catch (error) {
        if (!signal.aborted && isWorkspaceDenied(error))
          await recheckWorkspaceAccess(data, identity, id).catch(
            () => undefined,
          );
        throw error;
      }
    },
  });
}

export function clearInvitationHistory(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: ResourceId,
) {
  const key = invitationKey(identity, id);
  data.cancelResourceRequests(key);
  data.evict(identity, [key]);
}
