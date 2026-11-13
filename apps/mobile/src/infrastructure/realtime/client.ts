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
import type { SessionIdentity } from '../api/session-client.ts';

function aggregateKeys(identity: SessionIdentity): PrivateQueryKey[] {
  return [
    queryKeys.boardLists(identity),
    queryKeys.workspaces(identity),
    queryKeys.notifications(identity),
    queryKeys.home(identity),
    queryKeys.tasks(identity),
    queryKeys.search(identity),
  ];
}

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
  let accessEpoch = 0;
  const checks = new Set<string>();
  const verificationIds = new Set<string>();
  const verifications = new Map<string, AbortController>();
  let verificationTimer: unknown;
  let unsubscribeErrors: (() => void) | undefined;
  let unsubscribeDenied: (() => void) | undefined;
  function cancelVerification(boardId?: string) {
    if (boardId) {
      verificationIds.delete(boardId);
      verifications.get(boardId)?.abort();
      verifications.delete(boardId);
    } else {
      verificationIds.clear();
      for (const controller of verifications.values()) controller.abort();
      verifications.clear();
    }
    if (!verificationIds.size && verificationTimer !== undefined) {
      timers.clearTimeout(verificationTimer);
      verificationTimer = undefined;
    }
  }
  function clearChecks() {
    accessEpoch++;
    cancelVerification();
    if (accessTimer !== undefined) timers.clearTimeout(accessTimer);
    accessTimer = undefined;
    checks.clear();
    checkAll = false;
  }
  function resourceFailed(boardId: string, key: PrivateQueryKey) {
    const identity = data.getIdentity();
    if (!identity) return;
    data.cancelResourceRequests(key);
    data.evict(identity, [key]);
    if (verificationIds.has(boardId) || verifications.has(boardId)) return;
    verificationIds.add(boardId);
    if (verificationTimer !== undefined) return;
    verificationTimer = timers.setTimeout(() => {
      verificationTimer = undefined;
      const ids = [...verificationIds];
      verificationIds.clear();
      for (const id of ids) void verify(id, identity);
    }, 50);
  }
  async function verify(boardId: string, identity: SessionIdentity) {
    const controller = new AbortController();
    verifications.set(boardId, controller);
    try {
      // Untagged: an access-probe 403/404 must not recursively verify itself.
      const access = await data.api.json(
        `/boards/${encodeURIComponent(boardId)}`,
        decodeBoardAccess,
        {
          identity,
          signal: controller.signal,
          expectedStatus: 200,
          retries: 0,
        },
      );
      if (controller.signal.aborted) return;
      data.assertCurrent(identity);
      if (access.id !== boardId || !access.capabilities.canReadBoard) {
        rooms.revoke(boardId);
        return;
      }
      data.resources.confirmBoard(
        boardId,
        !access.isArchived && access.capabilities.canWriteBoard,
      );
      rooms.confirmAccess(access);
      // Do not refetch the failed child automatically: it may be deleted or a
      // forbidden operation. Existing room data and other child work stay valid.
    } catch (error) {
      if (controller.signal.aborted) return;
      try {
        data.assertCurrent(identity);
      } catch {
        return;
      }
      if (error instanceof ApiError && [403, 404].includes(error.status))
        rooms.revoke(boardId);
      // Network failures are not evidence of lost Board access.
    } finally {
      if (verifications.get(boardId) === controller)
        verifications.delete(boardId);
    }
  }
  function evictAccessSnapshots() {
    const identity = data.getIdentity();
    if (!identity) return;
    data.cancelRequests();
    data.resources.fenceAll();
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
    accessEpoch++;
    cancelVerification(boardId);
    rooms.suspend(boardId);
    if (boardId) checks.add(boardId);
    else checkAll = true;
    if (accessTimer !== undefined) return;
    const identity = data.getIdentity();
    if (!identity) return;
    accessTimer = timers.setTimeout(() => {
      accessTimer = undefined;
      const ticket = accessEpoch;
      const all = checkAll;
      const ids = [...checks];
      checks.clear();
      checkAll = false;
      void reconcile(identity);
      async function reconcile(identity: SessionIdentity) {
        try {
          data.assertCurrent(identity);
          if (all) await rooms.recheck();
          else await Promise.all(ids.map((id) => rooms.recheck(id)));
          if (ticket !== accessEpoch) return;
          data.assertCurrent(identity);
          // Aggregate REST endpoints enforce their own access rules. Never include
          // fenced Board keys, or infer access from a successful aggregate read.
          await data.invalidate(identity, [
            ...aggregateKeys(identity),
            ...(all
              ? [
                  [
                    ...queryKeys.scope(identity),
                    'workspaces',
                  ] as PrivateQueryKey,
                ]
              : []),
          ]);
        } catch {
          // A newer access check, session end or disposal owns subsequent recovery.
        }
      }
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
        cancelVerification(boardId);
        if (revoked) checks.delete(boardId);
        data.resources.fenceBoard(boardId, revoked);
        data.cancelResourceRequests(queryKeys.board(identity, boardId));
        data.evict(identity, [queryKeys.board(identity, boardId)]);
        if (revoked) {
          data.resources.fenceAggregates();
          data.evict(identity, aggregateKeys(identity));
          void data
            .invalidateHints(identity, aggregateKeys(identity))
            .catch(() => undefined);
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
      data.cancelRequests();
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
        if (hint.workspaceId)
          data.resources.fenceWorkspace(hint.workspaceId, true);
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
        data.evict(identity, aggregateKeys(identity));
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
      unsubscribeDenied ??= data.resources.subscribeDenied(resourceFailed);
      unsubscribeErrors ??= data.queryClient
        .getQueryCache()
        .subscribe((event) => {
          const identity = data.getIdentity();
          const key = event.query.queryKey;
          if (
            event.type !== 'updated' ||
            event.action.type !== 'error' ||
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
