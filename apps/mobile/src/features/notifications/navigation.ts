import type { NotificationResponse } from '@kanban/shared';
import { ApiError, invalidResponse } from '../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { decodeBoardAccess } from '../../infrastructure/realtime/rooms.ts';
import { parsePath, parseResourceId } from '../../navigation/routes.ts';
import { decodeWorkspace } from '../workspaces/decoder.ts';
import { evictWorkspace } from '../workspaces/queries.ts';
import { nativeInvitationFlow } from '../workspaces/invitations/flow.ts';
import { createInboxApi, type InboxFilter } from './api.ts';
import { notificationDestination } from './decoder.ts';
import { guardInboxCooldown, rememberInboxCooldown } from './retry.ts';

export async function verifyNotificationDestination(
  data: MobileDataLayer,
  identity: SessionIdentity,
  item: NotificationResponse,
  location: { filter: InboxFilter; page: number },
  signal: AbortSignal,
  flow = nativeInvitationFlow,
) {
  if (!notificationDestination(item))
    throw new ApiError('http', { status: 404 });
  guardInboxCooldown(data, identity, 'list');
  const root = queryKeys.notifications(identity),
    current = data.resources.capture(root, false);
  let boardId: string | undefined,
    workspaceId: string | undefined,
    checkBoard: (() => void) | undefined,
    checkWorkspace: (() => void) | undefined;
  const verified = () => {
    data.assertCurrent(identity);
    current();
    checkBoard?.();
    checkWorkspace?.();
    if (signal.aborted) throw new ApiError('aborted');
  };
  try {
    let proof: string | undefined;
    // Re-resolve this owned row. Paging changes may remove it from this window;
    // fail closed and let Inbox refresh, without walking all history.
    const page = await createInboxApi(data.api, identity).list(
      location.filter,
      location.page,
      signal,
      (id, value) => {
        if (id === item.id) proof = value;
      },
    );
    verified();
    const fresh = page.data.find(({ id }) => id === item.id);
    const path = fresh ? notificationDestination(fresh) : null;
    if (!fresh || !path) throw new ApiError('http', { status: 404 });
    if (fresh.kind !== item.kind) throw invalidResponse(200);
    const destination = parsePath(path)!;
    if (destination.kind === 'workspaceInvitation') {
      if (!proof) throw new ApiError('http', { status: 404 });
      verified();
      flow.intake('https://kanvexa.tech/invitations/workspace#proof=' + proof);
      flow.bind(identity);
    } else if (destination.kind === 'workspace') {
      workspaceId = destination.workspaceId;
      checkWorkspace = data.resources.captureWorkspaceProbe(workspaceId);
      const workspace = await data.api.json(
        '/workspaces/' + workspaceId,
        decodeWorkspace,
        { identity, signal, retries: 0, expectedStatus: 200 },
      );
      verified();
      if (workspace.id !== workspaceId) throw invalidResponse(200);
      data.resources.confirmWorkspace(workspace.id);
    } else if (destination.kind === 'board' || destination.kind === 'card') {
      boardId = destination.boardId;
      checkBoard = data.resources.captureBoardProbe(boardId);
      const board = await data.api.json(
        '/boards/' + boardId,
        decodeBoardAccess,
        { identity, signal, retries: 0, expectedStatus: 200 },
      );
      verified();
      if (board.id !== boardId) throw invalidResponse(200);
      if (!board.capabilities.canReadBoard)
        throw new ApiError('http', { status: 403 });
      // History can legitimately target archived, readable resources. Their
      // existing Board/Card guards retain archived/read-only behavior.
      data.resources.confirmBoard(
        board.id,
        board.capabilities.canWriteBoard,
        board.workspaceId,
      );
    } else throw invalidResponse(200);
    return path;
  } catch (error) {
    if (!signal.aborted && sameIdentity(identity, data.getIdentity())) {
      verified();
      rememberInboxCooldown(data, identity, 'list', error);
      if (error instanceof ApiError && [403, 404].includes(error.status)) {
        if (boardId) {
          data.resources.fenceBoard(boardId, true);
          data.evict(identity, [queryKeys.board(identity, boardId)]);
        }
        if (workspaceId)
          evictWorkspace(data, identity, parseResourceId(workspaceId)!);
        data.evict(identity, [root]);
      }
    }
    throw error;
  }
}
