import { ApiError } from '../api/errors.ts';
import type { PrivateQueryKey } from './keys.ts';
import { hashKey, partialMatchKey } from '@tanstack/react-query';

/** Local receive/response fence. Only a source-verified REST probe confirms access. */
export function createResourceAccess() {
  const boards = new Map<
    string,
    { version: number; read: boolean; write: boolean; denied: boolean }
  >();
  const workspaces = new Map<string, number>();
  const revokedWorkspaces = new Set<string>();
  let workspaceDirectory = 0;
  const deniedListeners = new Set<
    (boardId: string, key: PrivateQueryKey) => void
  >();
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
    if (key[4] === 'workspace-lists') return workspaceDirectory + aggregates;
    const id = boardId(key);
    if (id)
      return (
        (boards.get(id)?.version ?? 0) +
        [...resources.values()]
          .filter((resource) => partialMatchKey(key, resource.key))
          .reduce((total, resource) => total + resource.version, 0)
      );
    const workspace = workspaceId(key);
    if (workspace)
      return (
        (workspaces.get(workspace) ?? 0) +
        (key[4] === 'board-lists' ? aggregates : 0)
      );
    return key[4] === 'me' ? 0 : aggregates;
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
    });
  }
  function bumpKey(key: PrivateQueryKey) {
    const id = boardId(key);
    if (id && key.length > 6) {
      const hash = hashKey(key);
      resources.set(hash, {
        key,
        version: (resources.get(hash)?.version ?? 0) + 1,
      });
    } else if (id) {
      const previous = boards.get(id);
      boards.set(id, {
        version: (previous?.version ?? 0) + 1,
        read: previous?.read ?? true,
        write: previous?.write ?? true,
        denied: previous?.denied ?? false,
      });
    } else {
      const workspace = workspaceId(key);
      if (workspace)
        workspaces.set(workspace, (workspaces.get(workspace) ?? 0) + 1);
      else if (key[4] === 'workspace-lists') workspaceDirectory++;
      else aggregates++;
    }
  }
  return {
    capture,
    bumpKey,
    readable,
    boardId,
    fenceBoard,
    confirmBoard(id: string, writable: boolean) {
      const previous = boards.get(id);
      boards.set(id, {
        version: previous?.version ?? 0,
        read: true,
        write: writable,
        denied: false,
      });
    },
    fenceWorkspace(id: string, revoked = false) {
      workspaces.set(id, (workspaces.get(id) ?? 0) + 1);
      if (revoked) revokedWorkspaces.add(id);
    },
    confirmWorkspace(id: string) {
      revokedWorkspaces.delete(id);
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
    reset() {
      boards.clear();
      resources.clear();
      workspaces.clear();
      revokedWorkspaces.clear();
      workspaceDirectory++;
      aggregates++;
    },
  };
}
export type ResourceAccess = ReturnType<typeof createResourceAccess>;
