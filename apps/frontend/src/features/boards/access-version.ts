import type { QueryClient } from '@tanstack/react-query';

const versions = new WeakMap<QueryClient, Map<string, number>>();

export function boardAccessVersion(
  client: QueryClient,
  boardId: string,
): number {
  return versions.get(client)?.get(boardId.toLowerCase()) ?? 0;
}

/** A committed access transition invalidates responses from earlier mutations. */
export function changeBoardAccessVersion(client: QueryClient, boardId: string) {
  const entries = versions.get(client) ?? new Map<string, number>();
  entries.set(boardId.toLowerCase(), boardAccessVersion(client, boardId) + 1);
  versions.set(client, entries);
}
