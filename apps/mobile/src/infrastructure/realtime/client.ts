import type { SessionManager } from '../auth/session-manager.ts';
import { decodeSessionUser } from '../auth/session-api.ts';
import { ApiError } from '../api/errors.ts';
import type { MobileDataLayer } from '../query/data-layer.ts';
import { queryKeys } from '../query/keys.ts';
import { systemTimers, type Timers } from '../auth/clock.ts';
import { keyBelongsTo, type PrivateQueryKey } from '../query/keys.ts';
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
  const timers = options.timers ?? systemTimers;
  let everConnected = false;
  let accessTimer: unknown;
  let checkAll = false;
  const checks = new Set<string>();
  let unsubscribeErrors: (() => void) | undefined;
  let unsubscribeDenied: (() => void) | undefined;
  function clearChecks() {
    if (accessTimer !== undefined) timers.clearTimeout(accessTimer);
    accessTimer = undefined;
    checks.clear();
    checkAll = false;
  }
  function evictAccessSnapshots() {
    const identity = data.getIdentity();
    if (!identity) return;
    data.resources.fenceAggregates();
    const keys: PrivateQueryKey[] = [];
    for (const query of data.queryClient.getQueryCache().getAll()) {
      const key = query.queryKey;
      if (!keyBelongsTo(key, identity) || key[4] === 'me') continue;
      const boardId = data.resources.boardId(key);
      if (boardId) data.resources.fenceBoard(boardId);
      if (key[4] === 'workspaces' && typeof key[5] === 'string')
        data.resources.fenceWorkspace(key[5]);
      keys.push(key);
    }
    data.evict(identity, keys);
  }
  function accessCheck(boardId?: string) {
    rooms.suspend(boardId);
    if (boardId) checks.add(boardId);
    else checkAll = true;
    if (accessTimer !== undefined) return;
    const identity = data.getIdentity();
    if (!identity) return;
    accessTimer = timers.setTimeout(() => {
      accessTimer = undefined;
      try {
        data.assertCurrent(identity);
      } catch {
        clearChecks();
        return;
      }
      if (checkAll) rooms.recheck();
      else for (const id of checks) rooms.recheck(id);
      checks.clear();
      checkAll = false;
    }, 50);
  }
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
    fence(boardId, revoked) {
      const identity = data.getIdentity();
      if (identity) {
        data.resources.fenceBoard(boardId, revoked);
        data.evict(identity, [queryKeys.board(identity, boardId)]);
        if (revoked) {
          data.resources.fenceAggregates();
          data.evict(identity, [
            queryKeys.boardLists(identity),
            queryKeys.workspaces(identity),
            queryKeys.notifications(identity),
            queryKeys.home(identity),
            queryKeys.tasks(identity),
            queryKeys.search(identity),
          ]);
        }
      }
    },
    grant(access) {
      data.resources.confirmBoard(
        access.id,
        !access.isArchived && access.capabilities.canWriteBoard,
      );
    },
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
      clearChecks();
      rooms.lost();
      evictAccessSnapshots();
    },
    sessionEnded() {
      everConnected = false;
      rooms.reset();
    },
    receive(event, value) {
      const hint = parseHint(event, value);
      const identity = data.getIdentity();
      if (!hint || !identity) return;
      if (event === 'board:access-revoked') {
        rooms.revoke(hint.boardId!);
        return;
      }
      if (event === 'workspace:access-revoked' || event === 'access:changed') {
        evictAccessSnapshots();
        if (hint.workspaceId) data.resources.fenceWorkspace(hint.workspaceId);
        accessCheck();
        return;
      }
      if (
        event === 'member:removed' &&
        hint.userId === identity.userId &&
        hint.retainsReadAccess !== true
      ) {
        rooms.revoke(hint.boardId!);
        return;
      }
      if (
        event === 'board:access-changed' ||
        event === 'board:archived' ||
        event === 'board:restored' ||
        (event.startsWith('member:') && hint.userId === identity.userId)
      ) {
        data.resources.fenceAggregates();
        data.evict(identity, [
          queryKeys.boardLists(identity),
          queryKeys.workspaces(identity),
          queryKeys.notifications(identity),
          queryKeys.home(identity),
          queryKeys.tasks(identity),
          queryKeys.search(identity),
        ]);
        accessCheck(hint.boardId);
        return;
      }
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
    start() {
      unsubscribeDenied ??= data.resources.subscribeDenied((id) =>
        rooms.revoke(id),
      );
      unsubscribeErrors ??= data.queryClient
        .getQueryCache()
        .subscribe((event) => {
          const identity = data.getIdentity();
          const key = event.query.queryKey;
          if (
            event.type !== 'updated' ||
            !identity ||
            !keyBelongsTo(key, identity)
          )
            return;
          const error = event.query.state.error;
          if (error instanceof ApiError && [403, 404].includes(error.status))
            data.resources.denied(key);
        });
      connection.start();
    },
    stop() {
      connection.stop();
      clearChecks();
      unsubscribeErrors?.();
      unsubscribeErrors = undefined;
      unsubscribeDenied?.();
      unsubscribeDenied = undefined;
    },
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
      clearChecks();
      unsubscribeErrors?.();
      unsubscribeDenied?.();
      connection.dispose();
      rooms.dispose();
    },
  };
}
export type NativeRealtime = ReturnType<typeof createNativeRealtime>;
