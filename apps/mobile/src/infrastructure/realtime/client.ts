import type { SessionManager } from '../auth/session-manager.ts';
import { decodeSessionUser } from '../auth/session-api.ts';
import { ApiError } from '../api/errors.ts';
import type { MobileDataLayer } from '../query/data-layer.ts';
import { queryKeys } from '../query/keys.ts';
import type { Timers } from '../auth/clock.ts';
import { createConnection } from './connection.ts';
import { createBoardRooms, decodeBoardAccess } from './rooms.ts';
import { hintTargets } from './reconciliation.ts';
import { parseHint } from './contracts.ts';
import type { SocketFactory } from './socket.ts';

export function createNativeRealtime(options: {
  manager: SessionManager;
  data: MobileDataLayer;
  createSocket: SocketFactory | null;
  timers?: Timers;
}) {
  const { manager, data } = options;
  let everConnected = false;
  const rooms = createBoardRooms({
    timers: options.timers,
    socket: () => connection.getSocket(),
    async probe(boardId, signal) {
      const identity = data.getIdentity();
      if (!identity) throw new ApiError('unauthenticated');
      return data.api.json(
        `/boards/${encodeURIComponent(boardId)}`,
        decodeBoardAccess,
        { identity, signal, expectedStatus: 200, retries: 0 },
      );
    },
    fence(boardId) {
      const identity = data.getIdentity();
      if (identity) data.evict(identity, [queryKeys.board(identity, boardId)]);
    },
    grant() {},
    recovered(boardId) {
      const identity = data.getIdentity();
      if (identity)
        void data
          .invalidate(identity, [queryKeys.board(identity, boardId)])
          .catch(() => undefined);
    },
    unauthorized() {
      const identity = data.getIdentity();
      if (identity) manager.handleUnauthorized(identity.generation);
    },
    restart() {
      connection.restart();
    },
  });
  const connection = createConnection({
    manager,
    createSocket: options.createSocket,
    timers: options.timers,
    async verify(identity, signal) {
      const user = await data.api.json('/users/me', decodeSessionUser, {
        identity,
        signal,
        retries: 0,
        expectedStatus: 200,
      });
      if (user.id !== identity.userId) throw new ApiError('invalid-response');
    },
    connected(_socket, identity) {
      rooms.connected();
      if (everConnected) void data.recover(identity).catch(() => undefined);
      everConnected = true;
    },
    lost() {
      rooms.lost();
    },
    sessionEnded() {
      everConnected = false;
      rooms.reset();
    },
    receive(event, value) {
      const hint = parseHint(event, value);
      const identity = data.getIdentity();
      if (!hint || !identity) return;
      if (event === 'presence:sync')
        rooms.presence(hint.boardId!, hint.userIds!);
      else if (
        event === 'notifications:changed' ||
        (hint.boardId && rooms.isLive(hint.boardId))
      ) {
        void data
          .invalidateHints(
            identity,
            hintTargets(
              identity,
              event,
              hint,
              hint.boardId
                ? rooms.getSnapshot(hint.boardId).workspaceId
                : undefined,
            ),
          )
          .catch(() => undefined);
      }
    },
  });
  return {
    start: connection.start,
    stop: connection.stop,
    retry: connection.retry,
    setEnvironment: connection.setEnvironment,
    getSnapshot: connection.getSnapshot,
    subscribe: connection.subscribe,
    watchBoard(boardId: string) {
      if (!data.getIdentity()) throw new ApiError('unauthenticated');
      return rooms.watch(boardId);
    },
    getBoardSnapshot: rooms.getSnapshot,
    subscribeBoards: rooms.subscribe,
    retryBoard: rooms.recheck,
    dispose() {
      connection.dispose();
      rooms.dispose();
    },
  };
}
export type NativeRealtime = ReturnType<typeof createNativeRealtime>;
