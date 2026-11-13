import type { SessionManager } from '../auth/session-manager.ts';
import { decodeSessionUser } from '../auth/session-api.ts';
import { ApiError } from '../api/errors.ts';
import type { MobileDataLayer } from '../query/data-layer.ts';
import { queryKeys } from '../query/keys.ts';
import { systemTimers, type Timers } from '../auth/clock.ts';
import { keyBelongsTo, type PrivateQueryKey } from '../query/keys.ts';
import { createConnection } from './connection.ts';
import { createBoardRooms, decodeBoardAccess } from './rooms.ts';
import { hintTargets, workspaceBoardCandidates } from './reconciliation.ts';
import { parseHint } from './contracts.ts';
import type { SocketFactory } from './socket.ts';
import type { SessionIdentity } from '../api/session-client.ts';

function crossWorkspaceKeys(identity: SessionIdentity): PrivateQueryKey[] {
  return [
    queryKeys.notifications(identity),
    queryKeys.home(identity),
    queryKeys.tasks(identity),
    queryKeys.search(identity),
  ];
}

function aggregateKeys(identity: SessionIdentity): PrivateQueryKey[] {
  return [
    queryKeys.boardLists(identity),
    queryKeys.workspaces(identity),
    ...crossWorkspaceKeys(identity),
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
  const workspaceChecks = new Set<string>();
  let verificationTimer: unknown;
  let unsubscribeErrors: (() => void) | undefined;
  let unsubscribeDenied: (() => void) | undefined;
  let unsubscribeWorkspaceDenied: (() => void) | undefined;
  function workspaceOverviewKeys(
    identity: SessionIdentity,
    workspaceId?: string,
  ) {
    const result: PrivateQueryKey[] = [];
    for (const { queryKey } of data.queryClient.getQueryCache().getAll()) {
      if (
        keyBelongsTo(queryKey, identity) &&
        queryKey[4] === 'workspaces' &&
        queryKey[6] === 'overview' &&
        (!workspaceId || queryKey[5] === workspaceId)
      )
        result.push(queryKey);
    }
    return result;
  }
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
    queueVerification(boardId, identity);
  }
  function queueVerification(boardId: string, identity: SessionIdentity) {
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
  function workspaceDenied(workspaceId: string) {
    const identity = data.getIdentity();
    if (!identity) return;
    const boards = workspaceBoardCandidates(
      data,
      identity,
      workspaceId,
      rooms.watchedIds(),
    );
    const keys = [
      queryKeys.workspaceBoards(identity, null),
      ...crossWorkspaceKeys(identity),
    ];
    for (const key of keys) data.cancelResourceRequests(key);
    data.evict(identity, keys);
    // A Board may still be readable through explicit membership. Suspend
    // local reads and the room until the same REST probe used by MOB-06 settles.
    for (const id of boards) {
      rooms.suspend(id);
      workspaceChecks.add(id);
      queueVerification(id, identity);
    }
    void data.invalidateHints(identity, keys).catch(() => undefined);
  }
  function requeueWorkspaceChecks() {
    const identity = data.getIdentity();
    if (identity)
      for (const id of workspaceChecks) queueVerification(id, identity);
  }
  async function verify(boardId: string, identity: SessionIdentity) {
    const controller = new AbortController();
    verifications.set(boardId, controller);
    const workspaceCheck = workspaceChecks.has(boardId);
    const revoke = () => rooms.revoke(boardId, !workspaceCheck);
    try {
      // Untagged: an access-probe 403/404 must not recursively verify itself.
      const access = await data.api.json(
        `/boards/${encodeURIComponent(boardId)}`,
        decodeBoardAccess,
        {
          identity,
          signal: controller.signal,
          expectedStatus: 200,
          retries: workspaceCheck ? 1 : 0,
        },
      );
      if (controller.signal.aborted) return;
      data.assertCurrent(identity);
      if (access.id !== boardId || !access.capabilities.canReadBoard) {
        revoke();
        return;
      }
      data.resources.confirmBoard(
        boardId,
        !access.isArchived && access.capabilities.canWriteBoard,
        access.workspaceId,
      );
      rooms.confirmAccess(access, workspaceCheck);
      if (workspaceCheck) {
        workspaceChecks.delete(boardId);
        void data
          .invalidateHints(identity, [queryKeys.board(identity, boardId)])
          .catch(() => undefined);
      }
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
        revoke();
      // Keep suspended Workspace candidates fenced until a later successful check.
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
      const workspaceId = data.resources.workspaceId(key);
      if (workspaceId) data.resources.fenceWorkspace(workspaceId);
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
          if (all) await rooms.recheck(undefined, workspaceChecks);
          else
            await Promise.all(
              ids.map((id) => rooms.recheck(id, workspaceChecks)),
            );
          if (ticket !== accessEpoch) return;
          data.assertCurrent(identity);
          requeueWorkspaceChecks();
          // Aggregate REST endpoints enforce their own access rules. Never include
          // fenced Board keys, or infer access from a successful aggregate read.
          await data.invalidate(identity, [
            ...aggregateKeys(identity),
            ...workspaceOverviewKeys(identity),
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
    fence(boardId, revoked, reconcileAggregates = true) {
      const identity = data.getIdentity();
      if (identity) {
        cancelVerification(boardId);
        if (revoked) {
          checks.delete(boardId);
          workspaceChecks.delete(boardId);
        }
        data.resources.fenceBoard(boardId, revoked);
        data.cancelResourceRequests(queryKeys.board(identity, boardId));
        data.evict(identity, [queryKeys.board(identity, boardId)]);
        if (revoked && reconcileAggregates) {
          const workspaceId = rooms.getSnapshot(boardId).workspaceId;
          const keys = [
            ...aggregateKeys(identity),
            ...workspaceOverviewKeys(identity, workspaceId),
          ];
          data.resources.fenceAggregates();
          data.evict(identity, keys);
          void data.invalidateHints(identity, keys).catch(() => undefined);
        }
      }
    },
    grant(access) {
      workspaceChecks.delete(access.id);
      data.resources.confirmBoard(
        access.id,
        !access.isArchived && access.capabilities.canWriteBoard,
        access.workspaceId,
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
      rooms.connected(workspaceChecks);
      requeueWorkspaceChecks();
      if (everConnected) void data.recover(identity).catch(() => undefined);
      everConnected = true;
    },
    lost() {
      clearChecks();
      rooms.lost();
      // Before the first successful handshake, there are no receive grants
      // or missed socket events. A failed first connection must not discard
      // a fresh authorized REST read or strand Home in an access error.
      if (everConnected) evictAccessSnapshots();
      else requeueWorkspaceChecks();
    },
    sessionEnded() {
      clearChecks();
      workspaceChecks.clear();
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
        if (hint.workspaceId) {
          data.resources.fenceWorkspace(hint.workspaceId, true);
        }
        evictAccessSnapshots();
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
          ...aggregateKeys(identity),
          ...workspaceOverviewKeys(
            identity,
            rooms.getSnapshot(hint.boardId!).workspaceId,
          ),
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
      unsubscribeDenied ??= data.resources.subscribeDenied(resourceFailed);
      unsubscribeWorkspaceDenied ??=
        data.resources.subscribeWorkspaceDenied(workspaceDenied);
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
      workspaceChecks.clear();
      unsubscribeErrors?.();
      unsubscribeErrors = undefined;
      unsubscribeDenied?.();
      unsubscribeDenied = undefined;
      unsubscribeWorkspaceDenied?.();
      unsubscribeWorkspaceDenied = undefined;
    },
    retry: connection.retry,
    setEnvironment(
      environment: Parameters<typeof connection.setEnvironment>[0],
    ) {
      connection.setEnvironment(environment);
      if (environment.online && environment.foreground)
        requeueWorkspaceChecks();
    },
    getSnapshot: connection.getSnapshot,
    subscribe: connection.subscribe,
    watchBoard(boardId: string) {
      if (!data.getIdentity()) throw new ApiError('unauthenticated');
      return rooms.watch(boardId);
    },
    getBoardSnapshot: rooms.getSnapshot,
    subscribeBoards: rooms.subscribe,
    async retryBoard(boardId?: string) {
      const identity = data.getIdentity();
      if (!identity) return;
      const ids = boardId ? [boardId] : [...workspaceChecks];
      for (const id of ids)
        if (workspaceChecks.has(id)) queueVerification(id, identity);
      await rooms.recheck(boardId, workspaceChecks);
    },
    dispose() {
      clearChecks();
      unsubscribeErrors?.();
      unsubscribeDenied?.();
      unsubscribeWorkspaceDenied?.();
      connection.dispose();
      rooms.dispose();
    },
  };
}
export type NativeRealtime = ReturnType<typeof createNativeRealtime>;
