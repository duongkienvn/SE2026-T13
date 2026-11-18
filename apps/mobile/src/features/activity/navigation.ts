import { ApiError } from '../../infrastructure/api/errors.ts';
import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import type { PrivateQueryKey } from '../../infrastructure/query/keys.ts';
import { destinationPath, type ResourceId } from '../../navigation/routes.ts';
import { decodeBoard } from '../boards/api.ts';
import { createCardApi } from '../cards/api.ts';
import { createWorkspaceApi } from '../workspaces/api.ts';
import { activityCardId, type BoardActivity } from './board/decoder.ts';

export type ActivityTarget =
  | { kind: 'board'; boardId: ResourceId; workspaceId: ResourceId }
  | { kind: 'card'; boardId: ResourceId; event: BoardActivity };

/** Returns a route only after REST confirms the resource and its current parent. */
export async function verifyActivityTarget(
  data: MobileDataLayer,
  identity: SessionIdentity,
  source: PrivateQueryKey,
  target: ActivityTarget,
  signal: AbortSignal,
) {
  const current = data.resources.capture(source, false);
  const probeCurrent = data.resources.captureBoardProbe(target.boardId);
  const check = () => {
    data.assertCurrent(identity);
    current();
    probeCurrent();
    if (signal.aborted) throw new ApiError('aborted');
  };
  if (target.kind === 'board') {
    await createWorkspaceApi(data.api, identity).detail(
      target.workspaceId,
      signal,
    );
    check();
  } else if (!activityCardId(target.event, target.boardId))
    throw new ApiError('http', { status: 404 });
  const board = await data.api.json(`/boards/${target.boardId}`, decodeBoard, {
    identity,
    signal,
    expectedStatus: 200,
    retries: 0,
  });
  check();
  if (
    board.id !== target.boardId ||
    !board.capabilities.canReadBoard ||
    (target.kind === 'board' && board.workspaceId !== target.workspaceId)
  )
    throw new ApiError('http', { status: 404 });
  if (target.kind === 'board')
    return destinationPath({ kind: 'board', boardId: board.id });
  const cardId = activityCardId(target.event, target.boardId)!;
  const card = await createCardApi(data.api, identity, target.boardId).getCard(
    cardId,
    signal,
  );
  check();
  if (card.id !== cardId || card.boardId !== target.boardId)
    throw new ApiError('http', { status: 404 });
  return destinationPath({ kind: 'card', boardId: board.id, cardId });
}
