import { ApiError } from '../api/errors.ts';
import type { PrivateQueryKey } from './keys.ts';
import { hashKey, partialMatchKey } from '@tanstack/react-query';

/** Local receive/response fence. Only a source-verified REST probe confirms access. */
export function createResourceAccess() {
  const boards = new Map<
    string,
    {
      version: number;
      read: boolean;
      write: boolean;
      denied: boolean;
      workspaceId?: string;
    }
  >();
  const workspaces = new Map<string, number>();
  // Confirmations order access probes without invalidating ordinary scoped reads.
  const workspaceProbes = new Map<string, number>();
  let workspaceProbeRevision = 0; // Remains monotonic across scope resets.
  const revokedWorkspaces = new Set<string>();
  let workspaceDirectory = 0;
  const deniedListeners = new Set<
    (boardId: string, key: PrivateQueryKey) => void
  >();
  const workspaceDeniedListeners = new Set<(workspaceId: string) => void>();
  const boardTeardownListeners = new Set<(boardId?: string) => void>();
  const resources = new Map<
    string,
    { key: PrivateQueryKey; version: number }
  >();
  let aggregates = 0;
  function boardId(key: readonly unknown[]) {
    return key[4] === 'boards' && typeof key[5] === 'string'
      ? key[5].toLowerCase()
      : null;
  }
  function workspaceId(key: readonly unknown[]) {
    return (key[4] === 'workspaces' || key[4] === 'board-lists') &&
      typeof key[5] === 'string'
      ? key[5]
      : null;
  }
  function version(key: PrivateQueryKey): number {
    const scoped = [...resources.values()]
      .filter((resource) => partialMatchKey(key, resource.key))
      .reduce((total, resource) => total + resource.version, 0);
    if (key[4] === 'workspace-lists')
      return workspaceDirectory + aggregates + scoped;
    const id = boardId(key);
    if (id) return (boards.get(id)?.version ?? 0) + scoped;
    const workspace = workspaceId(key);
    if (workspace)
      return (
        (workspaces.get(workspace) ?? 0) +
        (key[4] === 'board-lists' ? aggregates : 0) +
        scoped
      );
    return key[4] === 'me' ? 0 : aggregates + scoped;
  }
  function readable(key: readonly unknown[]) {
    const workspace = workspaceId(key);
    if (workspace) return !revokedWorkspaces.has(workspace);
    const id = boardId(key);
    return !id || !boards.has(id) || boards.get(id)!.read;
  }
  function capture(key: PrivateQueryKey, write: boolean) {
    const id = boardId(key);
    if (id && !boards.has(id))
      boards.set(id, { version: 0, read: true, write: true, denied: false });
    const workspace = workspaceId(key);
    if (workspace && !workspaces.has(workspace)) workspaces.set(workspace, 0);
    const revision = version(key);
    const check = () => {
      const board = id ? boards.get(id) : null;
      if (
        version(key) !== revision ||
        !readable(key) ||
        (write && board && !board.write)
      )
        throw new ApiError('session-changed', {
          code: 'RESOURCE_ACCESS_CHANGED',
          message: 'Resource access must be rechecked.',
        });
    };
    check();
    return check;
  }
  function fenceBoard(id: string, denied = false) {
    const previous = boards.get(id);
    if (denied && previous?.denied) return;
    boards.set(id, {
      version: (previous?.version ?? 0) + 1,
      read: false,
      write: false,
      denied: denied || previous?.denied === true,
      workspaceId: previous?.workspaceId,
    });
    if (denied) for (const listener of boardTeardownListeners) listener(id);
  }
  function bumpKey(key: PrivateQueryKey) {
    const id = boardId(key);
    const workspace = workspaceId(key);
    if (id && key.length === 6) {
      const previous = boards.get(id);
      boards.set(id, {
        version: (previous?.version ?? 0) + 1,
        read: previous?.read ?? true,
        write: previous?.write ?? true,
        denied: previous?.denied ?? false,
        workspaceId: previous?.workspaceId,
      });
    } else if (workspace)
      workspaces.set(workspace, (workspaces.get(workspace) ?? 0) + 1);
    else if (key[4] === 'workspace-lists') workspaceDirectory++;
    else {
      const hash = hashKey(key);
      resources.set(hash, {
        key,
        version: (resources.get(hash)?.version ?? 0) + 1,
      });
    }
  }
  return {
    capture,
    captureWorkspaceProbe(id: string) {
      if (!workspaces.has(id)) workspaces.set(id, 0);
      const revision = workspaces.get(id)!;
      const probeRevision = workspaceProbes.get(id) ?? ++workspaceProbeRevision;
      workspaceProbes.set(id, probeRevision);
      return () => {
        if (
          workspaces.get(id) !== revision ||
          workspaceProbes.get(id) !== probeRevision
        )
          throw new ApiError('session-changed', {
            code: 'RESOURCE_ACCESS_CHANGED',
          });
      };
    },
    captureBoardProbe(id: string) {
      const revision = boards.get(id)?.version ?? 0;
      return () => {
        if ((boards.get(id)?.version ?? 0) !== revision)
          throw new ApiError('session-changed', {
            code: 'RESOURCE_ACCESS_CHANGED',
          });
      };
    },
    /** Aggregate reads learn their Board IDs only when the response arrives. */
    captureBoardVersions() {
      const versions = new Map(
        [...boards].map(([id, board]) => [id, board.version]),
      );
      return (ids: Iterable<string>) => {
        for (const id of ids)
          if ((boards.get(id)?.version ?? 0) !== (versions.get(id) ?? 0))
            throw new ApiError('session-changed', {
              code: 'RESOURCE_ACCESS_CHANGED',
            });
      };
    },
    bumpKey,
    readable,
    boardId,
    workspaceId,
    trackedWorkspaceIds: () => workspaces.keys(),
    fenceBoard,
    boardWorkspace: (id: string) => boards.get(id)?.workspaceId,
    trackedBoardIds: () => boards.keys(),
    rememberBoardWorkspace(id: string, workspaceId: string) {
      const board = boards.get(id);
      if (board) board.workspaceId = workspaceId;
    },
    confirmBoard(id: string, writable: boolean, workspaceId?: string) {
      const previous = boards.get(id);
      boards.set(id, {
        version: previous?.version ?? 0,
        read: true,
        write: writable,
        denied: false,
        workspaceId: workspaceId ?? previous?.workspaceId,
      });
      if (!writable)
        for (const listener of boardTeardownListeners) listener(id);
    },
    fenceWorkspace(id: string, revoked = false) {
      workspaces.set(id, (workspaces.get(id) ?? 0) + 1);
      if (revoked) revokedWorkspaces.add(id);
    },
    denyWorkspace(id: string) {
      workspaces.set(id, (workspaces.get(id) ?? 0) + 1);
      if (revokedWorkspaces.has(id)) return;
      revokedWorkspaces.add(id);
      for (const listener of [...workspaceDeniedListeners]) listener(id);
    },
    subscribeWorkspaceDenied(listener: (id: string) => void) {
      workspaceDeniedListeners.add(listener);
      return () => {
        workspaceDeniedListeners.delete(listener);
      };
    },
    confirmWorkspace(id: string) {
      revokedWorkspaces.delete(id);
      workspaceProbes.set(id, ++workspaceProbeRevision);
    },
    fenceAll() {
      aggregates++;
      for (const [id, previous] of boards)
        boards.set(id, {
          ...previous,
          version: previous.version + 1,
          read: false,
          write: false,
        });
      for (const [id, previous] of workspaces) workspaces.set(id, previous + 1);
    },
    fenceAggregates() {
      aggregates++;
    },
    denied(key: PrivateQueryKey) {
      const id = boardId(key);
      // Child 403/404 can mean authorship or deletion, not loss of Board access.
      // Fence only the failed resource; the authoritative probe decides Board loss.
      if (id && (boards.get(id)?.read ?? true)) {
        bumpKey(key);
        for (const listener of [...deniedListeners]) listener(id, key);
      }
    },
    subscribeDenied(listener: (id: string, key: PrivateQueryKey) => void) {
      deniedListeners.add(listener);
      return () => {
        deniedListeners.delete(listener);
      };
    },
    subscribeBoardTeardown(listener: (boardId?: string) => void) {
      boardTeardownListeners.add(listener);
      return () => {
        boardTeardownListeners.delete(listener);
      };
    },
    reset() {
      for (const listener of boardTeardownListeners) listener();
      boards.clear();
      resources.clear();
      workspaces.clear();
      workspaceProbes.clear();
      revokedWorkspaces.clear();
      workspaceDirectory++;
      aggregates++;
    },
  };
}
export type ResourceAccess = ReturnType<typeof createResourceAccess>;
