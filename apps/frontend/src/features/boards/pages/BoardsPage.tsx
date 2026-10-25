import { BoardRole } from '@kanban/shared';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { FolderIcon, PlusIcon } from '../../../components/icons';
import { PageContainer } from '../../../components/PageContainer';
import { PageHeader } from '../../../components/PageHeader';
import { Pagination } from '../../../components/Pagination';
import { SearchField } from '../../../components/SearchField';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../../components/states';
import { useFitGrid } from '../../../hooks/useFitGrid';
import { usePageParam } from '../../../hooks/usePageParam';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { paginate } from '../../../lib/pagination';
import { ArchiveBoardDialog } from '../components/ArchiveBoardDialog';
import { BoardCard } from '../components/BoardCard';
import {
  CreateBoardDialog,
  EditBoardDialog,
} from '../components/BoardFormDialog';
import { useBoards } from '../hooks';
import type { Board } from '../types';

/** Router state other pages can pass to show a one-time notice here. */
export interface BoardsLocationState {
  notice?: string;
}

function matches(board: Board, query: string): boolean {
  const text = `${board.name} ${board.description ?? ''}`.toLowerCase();
  return text.includes(query);
}

export function BoardsPage() {
  usePageTitle('Boards');
  const boards = useBoards();
  const fit = useFitGrid({
    gap: 16,
    minColumnWidth: 280,
    maxColumns: 3,
    reserve: 8,
    fallbackRows: 4,
  });
  const [page, setPage] = usePageParam();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Board | null>(null);
  const [archiving, setArchiving] = useState<Board | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const incoming = (location.state as BoardsLocationState | null)?.notice;
  const [notice, setNotice] = useState<string | undefined>(incoming);

  // Show an incoming notice once; drop it from history so reloads don't repeat it.
  useEffect(() => {
    if (!incoming) return;
    const { pathname, search, hash } = location;
    navigate({ pathname, search, hash }, { replace: true, state: null });
  }, [incoming, location, navigate]);

  const loaded = useMemo(
    () => (boards.data ?? []).filter((board) => !board.isArchived),
    [boards.data],
  );
  const query = search.trim().toLowerCase();
  const visible = query
    ? loaded.filter((board) => matches(board, query))
    : loaded;
  const shown = paginate(visible, page, fit.pageSize);

  const openCreate = () => {
    setNotice(undefined);
    setCreating(true);
  };
  const changeSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  return (
    <PageContainer fill>
      <PageHeader
        title="Boards"
        description="Organize your work with Kanban boards for different projects and teams."
        actions={
          loaded.length > 0 || search ? (
            <>
              {/* Keep the box while a query is active, so it can always be cleared. */}
              {(loaded.length > 0 || search) && (
                <SearchField
                  label="Search boards"
                  placeholder="Search boards..."
                  value={search}
                  onChange={changeSearch}
                  className="w-full sm:w-[280px]"
                />
              )}
              {loaded.length > 0 && (
                <Button onClick={openCreate}>
                  <PlusIcon aria-hidden="true" className="size-4.5" />
                  New Board
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {notice && (
        <div className="mt-4">
          <Alert variant="success">{notice}</Alert>
        </div>
      )}

      {/* Fills the remaining height; the page size is however many rows fit here. */}
      <div ref={fit.ref} className="mt-5 min-h-0 flex-1">
        {boards.isPending ? (
          <LoadingState label="Loading boards…" />
        ) : boards.isError && !boards.data ? (
          <ErrorState
            title="We couldn't load your boards"
            description="Check your connection and try again."
            onRetry={() => void boards.refetch()}
          />
        ) : loaded.length === 0 ? (
          <EmptyState
            icon={<FolderIcon />}
            title="No boards yet"
            description="Create your first board, or ask a board owner to add you."
            action={<Button onClick={openCreate}>Create board</Button>}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No matching boards"
            description={`No board matches “${search.trim()}”.`}
          />
        ) : (
          <ul
            className="-mx-1 grid gap-4 p-1"
            style={{
              gridTemplateColumns: `repeat(${fit.columns}, minmax(0, 1fr))`,
            }}
          >
            {shown.items.map((board) => (
              <li key={board.id} data-fit-row className="flex">
                <BoardCard
                  board={board}
                  // UI hint only: the backend enforces OWNER-only actions.
                  onEdit={
                    board.currentUserRole === BoardRole.OWNER
                      ? () => setEditing(board)
                      : undefined
                  }
                  onArchive={
                    board.currentUserRole === BoardRole.OWNER
                      ? () => setArchiving(board)
                      : undefined
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <Pagination
        label="Boards pages"
        page={shown.page}
        pageCount={shown.pageCount}
        onChange={setPage}
        className="mt-4 shrink-0"
      />

      <CreateBoardDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(board) => {
          setCreating(false);
          setNotice(`Board “${board.name}” created.`);
        }}
      />
      {editing && (
        <EditBoardDialog
          board={editing}
          open
          onClose={() => setEditing(null)}
          onSaved={(board) => {
            setEditing(null);
            setNotice(`Board “${board.name}” updated.`);
          }}
        />
      )}
      {archiving && (
        <ArchiveBoardDialog
          board={archiving}
          open
          onClose={() => setArchiving(null)}
          onArchived={(board) => {
            setArchiving(null);
            setNotice(`Board “${board.name}” archived.`);
          }}
        />
      )}
    </PageContainer>
  );
}
