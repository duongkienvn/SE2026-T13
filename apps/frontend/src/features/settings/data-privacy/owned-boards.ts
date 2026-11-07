import { useMemo } from 'react';
import { useBoards } from '../../boards/hooks';
import type { Board } from '../../boards/types';
import { useWorkspaceDirectory } from '../../workspaces/hooks';

export interface ExportableBoard {
  id: string;
  name: string;
  isArchived: boolean;
  /** Present only when the Workspace directory is loaded. */
  workspaceName: string | null;
}

/**
 * Boards whose export the server can allow: the user's explicit OWNER role,
 * active and archived (#216). `currentUserRole` is the caller's own Board
 * membership, so Workspace ADMIN or Workspace-wide read access never counts.
 */
export function ownedBoards(
  active: Board[],
  archived: Board[],
  workspaceNames: ReadonlyMap<string, string>,
): ExportableBoard[] {
  const seen = new Set<string>();
  const result: ExportableBoard[] = [];
  for (const board of [...active, ...archived]) {
    if (board.currentUserRole !== 'OWNER' || seen.has(board.id)) continue;
    seen.add(board.id);
    result.push({
      id: board.id,
      name: board.name,
      isArchived: board.isArchived,
      workspaceName: board.workspaceId
        ? (workspaceNames.get(board.workspaceId) ?? null)
        : null,
    });
  }
  return result.sort(
    (a, b) =>
      Number(a.isArchived) - Number(b.isArchived) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
      a.id.localeCompare(b.id),
  );
}

/** The accessible option text: name, Workspace context and archived status. */
export function exportableBoardLabel(board: ExportableBoard): string {
  return [board.name, board.workspaceName, board.isArchived ? 'Archived' : null]
    .filter(Boolean)
    .join(' · ');
}

/** Reuses the shared Board list queries, so access revocation clears them too. */
export function useExportableBoards() {
  const active = useBoards('active');
  const archived = useBoards('archived');
  const directory = useWorkspaceDirectory();
  const names = useMemo(
    () => new Map(directory.workspaces.map((w) => [w.id, w.name] as const)),
    [directory.workspaces],
  );
  const boards = useMemo(
    () =>
      active.data && archived.data
        ? ownedBoards(active.data, archived.data, names)
        : null,
    [active.data, archived.data, names],
  );
  const isError = !boards && (active.isError || archived.isError);
  return {
    boards,
    isError,
    retry: () => {
      if (active.isError) void active.refetch();
      if (archived.isError) void archived.refetch();
    },
  };
}
