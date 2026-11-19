import type { TaskCardSummary } from '@kanban/shared';
import { ApiError } from '../../infrastructure/api/errors.ts';
import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { decodeBoardAccess } from '../../infrastructure/realtime/rooms.ts';
import { destinationPath, parseResourceId } from '../../navigation/routes.ts';

export async function verifyTaskDestination(
  data: MobileDataLayer,
  identity: SessionIdentity,
  task: TaskCardSummary,
  signal: AbortSignal,
) {
  const boardId = parseResourceId(task.boardId);
  const cardId = parseResourceId(task.id);
  if (!boardId || !cardId) throw new ApiError('configuration');
  const checkBoard = data.resources.captureBoardProbe(boardId);
  try {
    // The resource probe is deliberately untagged so suspended Board reads can recover.
    const board = await data.api.json('/boards/' + boardId, decodeBoardAccess, {
      identity,
      signal,
      expectedStatus: 200,
      retries: 0,
    });
    data.assertCurrent(identity);
    checkBoard();
    if (
      signal.aborted ||
      board.id !== boardId ||
      board.isArchived ||
      !board.capabilities.canReadBoard
    )
      throw new ApiError('http', { status: 403 });
    data.resources.confirmBoard(
      boardId,
      board.capabilities.canWriteBoard,
      board.workspaceId,
    );
    return destinationPath({ kind: 'card', boardId, cardId });
  } catch (error) {
    if (
      !signal.aborted &&
      error instanceof ApiError &&
      [403, 404].includes(error.status)
    ) {
      data.resources.fenceBoard(boardId, true);
      data.evict(identity, [
        queryKeys.tasks(identity),
        queryKeys.board(identity, boardId),
      ]);
      void data
        .invalidateHints(identity, [queryKeys.tasks(identity)])
        .catch(() => undefined);
    }
    throw error;
  }
}
