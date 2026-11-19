import type { GlobalSearchItem } from '@kanban/shared';
import { ApiError, invalidResponse } from '../../infrastructure/api/errors.ts';
import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { decodeBoardAccess } from '../../infrastructure/realtime/rooms.ts';
import { parseResourceId } from '../../navigation/routes.ts';
import { decodeWorkspace } from '../workspaces/decoder.ts';
import { evictWorkspace } from '../workspaces/queries.ts';
import { searchDestination } from './decoder.ts';

export async function verifySearchDestination(
  data: MobileDataLayer,
  identity: SessionIdentity,
  item: GlobalSearchItem,
  signal: AbortSignal,
) {
  const path = searchDestination(item);
  const searchKey = queryKeys.search(identity);
  const current = data.resources.capture(searchKey, false);
  const boardId =
    item.type === 'workspace'
      ? null
      : parseResourceId(item.type === 'card' ? item.boardId : item.id)!;
  const checkBoard = boardId ? data.resources.captureBoardProbe(boardId) : null;
  const verified = () => {
    data.assertCurrent(identity);
    current();
    checkBoard?.();
    if (signal.aborted) throw new ApiError('aborted');
  };
  try {
    // Probes are untagged to allow recovery of previously suspended resource reads.
    // Never fetch a guest's hidden Workspace context to decorate a Board/Card row.
    if (item.type === 'workspace') {
      const workspace = await data.api.json(
        '/workspaces/' + item.id,
        decodeWorkspace,
        { identity, signal, retries: 0, expectedStatus: 200 },
      );
      verified();
      if (workspace.id !== item.id) throw invalidResponse(200);
      data.resources.confirmWorkspace(workspace.id);
    } else {
      const board = await data.api.json(
        '/boards/' + boardId,
        decodeBoardAccess,
        { identity, signal, retries: 0, expectedStatus: 200 },
      );
      verified();
      if (board.id !== boardId) throw invalidResponse(200);
      if (board.isArchived || !board.capabilities.canReadBoard)
        throw new ApiError('http', { status: 403 });
      data.resources.confirmBoard(
        board.id,
        board.capabilities.canWriteBoard,
        board.workspaceId,
      );
    }
    // Board and Card routes still perform their existing resource-specific REST guards.
    return path;
  } catch (error) {
    if (
      !signal.aborted &&
      error instanceof ApiError &&
      [403, 404].includes(error.status)
    ) {
      data.assertCurrent(identity);
      if (item.type === 'workspace')
        evictWorkspace(data, identity, parseResourceId(item.id)!);
      else {
        data.resources.fenceBoard(boardId!, true);
        data.evict(identity, [queryKeys.board(identity, boardId!)]);
      }
      data.evict(identity, [searchKey]);
      void data.invalidateHints(identity, [searchKey]).catch(() => undefined);
    }
    throw error;
  }
}
