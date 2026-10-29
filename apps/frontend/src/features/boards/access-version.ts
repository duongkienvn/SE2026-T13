import type { QueryClient } from '@tanstack/react-query';

const versions = new WeakMap<QueryClient, Map<string, number>>();
const sessionVersions = new WeakMap<QueryClient, number>();

export function boardAccessVersion(
  client: QueryClient,
  boardId: string,
): number {
  return (
    (versions.get(client)?.get(boardId.toLowerCase()) ?? 0) +
    (sessionVersions.get(client) ?? 0)
  );
}

/** A committed access transition invalidates responses from earlier mutations. */
export function changeBoardAccessVersion(client: QueryClient, boardId: string) {
  const entries = versions.get(client) ?? new Map<string, number>();
  const id = boardId.toLowerCase();
  entries.set(id, (entries.get(id) ?? 0) + 1);
  versions.set(client, entries);
}

/** Invalidate pending writes even when their Board is present only in a list. */
export function changeAllBoardAccessVersions(client: QueryClient) {
  sessionVersions.set(client, (sessionVersions.get(client) ?? 0) + 1);
}
