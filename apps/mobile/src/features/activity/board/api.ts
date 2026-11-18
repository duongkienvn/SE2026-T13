import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import {
  activityPage,
  activityPageSize,
  decodeRows,
  id,
  validatePagination,
} from '../contracts.ts';
import { activityKeys, activityPageKey } from '../keys.ts';
import { decodeBoardActivity } from './decoder.ts';

export function createBoardActivityApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
  boardId: string,
) {
  const board = id(boardId);
  return {
    async list(
      page: number,
      explicitMember: boolean,
      signal: AbortSignal,
      limit = activityPageSize,
    ) {
      validatePagination(page, limit);
      return activityPage(
        await api.envelope(
          `/boards/${board}/activities`,
          decodeRows(
            (value) => decodeBoardActivity(value, board, explicitMember),
            limit,
          ),
          {
            identity,
            signal,
            resourceKey: activityPageKey(
              activityKeys.board(identity, board),
              page,
              limit,
            ),
            expectedStatus: 200,
            retries: 0,
            query: { page, limit },
          },
        ),
        page,
        limit,
      );
    },
  };
}
