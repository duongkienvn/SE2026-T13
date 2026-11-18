import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';

export const activityKeys = {
  workspace: (identity: SessionIdentity, workspaceId: string) =>
    [...queryKeys.workspace(identity, workspaceId), 'activity'] as const,
  board: (identity: SessionIdentity, boardId: string) =>
    [...queryKeys.board(identity, boardId), 'activity'] as const,
};

export const activityPageKey = (
  prefix:
    | ReturnType<(typeof activityKeys)['board']>
    | ReturnType<(typeof activityKeys)['workspace']>,
  page: number,
  limit: number,
) => [...prefix, { page, limit }] as const;
