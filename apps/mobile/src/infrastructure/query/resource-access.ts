import { ApiError } from '../api/errors.ts';
import type { PrivateQueryKey } from './keys.ts';

/** Local receive/response fence. Only a source-verified REST probe confirms access. */
export function createResourceAccess() {
  const boards = new Map<
    string,
    { version: number; read: boolean; write: boolean; denied: boolean }
  >();
  const workspaces = new Map<string, number>();
  const deniedListeners = new Set<(boardId: string) => void>();
  let aggregates = 0;
  function boardId(key: readonly unknown[]) {
    return key[4] === 'boards' && typeof key[5] === 'string'
      ? key[5].toLowerCase()
      : null;
  }
  function version(key: PrivateQueryKey): number {
    const id = boardId(key);
    if (id) return boards.get(id)?.version ?? 0;
    if (key[4] === 'workspaces' && typeof key[5] === 'string')
      return workspaces.get(key[5]) ?? 0;
    return key[4] === 'me' ? 0 : aggregates;
  }
  function readable(key: readonly unknown[]) {
    const id = boardId(key);
    return !id || !boards.has(id) || boards.get(id)!.read;
  }
  function capture(key: PrivateQueryKey, write: boolean) {
    const id = boardId(key);
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
      denied,
    });
  }
  return {
    capture,
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
    fenceWorkspace(id: string) {
      workspaces.set(id, (workspaces.get(id) ?? 0) + 1);
    },
    fenceAggregates() {
      aggregates++;
    },
    denied(key: PrivateQueryKey) {
      const id = boardId(key);
      if (id && !boards.get(id)?.denied) {
        fenceBoard(id, true);
        for (const listener of [...deniedListeners]) listener(id);
      }
    },
    subscribeDenied(listener: (id: string) => void) {
      deniedListeners.add(listener);
      return () => {
        deniedListeners.delete(listener);
      };
    },
    reset() {
      boards.clear();
      workspaces.clear();
      aggregates++;
    },
  };
}
export type ResourceAccess = ReturnType<typeof createResourceAccess>;
