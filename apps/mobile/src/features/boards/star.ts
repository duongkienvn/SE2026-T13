import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { createBoardApi, type BoardUserState } from './api.ts';

const pending = new WeakMap<MobileDataLayer, Map<string, number>>();
function marker(identity: SessionIdentity, id: string) {
  return `${identity.userId}:${identity.generation}:${id.toLowerCase()}`;
}
export function isBoardStarPending(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: string,
) {
  return (pending.get(data)?.get(marker(identity, id)) ?? 0) > 0;
}

export function boardStarKey(identity: SessionIdentity, id: string) {
  return [...queryKeys.board(identity, id), 'user-state'] as const;
}

/** Per-user state requires Board read access, including for archived Boards. */
export function setBoardStar(
  data: MobileDataLayer,
  identity: SessionIdentity,
  id: string,
  starred: boolean,
) {
  const key = boardStarKey(identity, id);
  let counts = pending.get(data);
  if (!counts) {
    counts = new Map();
    pending.set(data, counts);
  }
  const markerKey = marker(identity, id);
  counts.set(markerKey, (counts.get(markerKey) ?? 0) + 1);
  const current = counts;
  return data
    .optimistic<BoardUserState, BoardUserState>({
      identity,
      key,
      requiresWrite: false,
      update: (previous) => ({
        isStarred: starred,
        lastViewedAt: previous?.lastViewedAt ?? null,
      }),
      mutation: () =>
        createBoardApi(data.api, identity).star(
          id,
          starred,
          new AbortController().signal,
        ),
      reconcile: (result) => result,
      invalidate: [
        queryKeys.boardLists(identity),
        queryKeys.home(identity),
        key,
      ],
    })
    .finally(() => {
      const remaining = (current.get(markerKey) ?? 1) - 1;
      if (remaining) current.set(markerKey, remaining);
      else current.delete(markerKey);
    });
}
