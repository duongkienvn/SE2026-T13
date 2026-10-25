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
import { RestoreBoardDialog } from '../components/RestoreBoardDialog';
import { BoardCard, CreateBoardTile } from '../components/BoardCard';
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

const CREATE_TILE = 'create' as const;

function matches(board: Board, query: string): boolean {
  const text = `${board.name} ${board.description ?? ''}`.toLowerCase();
  return text.includes(query);
}

export function BoardsPage() {
  usePageTitle('Boards');
  const location = useLocation();
  const navigate = useNavigate();
  const status =
    new URLSearchParams(location.search).get('status') === 'archived'
      ? 'archived'
      : 'active';
  const boards = useBoards(status);
  const fit = useFitGrid({
    gap: 16,
    minColumnWidth: 280,
    maxColumns: 3,
    reserve: 8,
    fallbackRows: 4,
  });
  const [page, setPage] = usePageParam();
  const [searches, setSearches] = useState({ active: '', archived: '' });
  const search = searches[status];
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Board | null>(null);
  const [archiving, setArchiving] = useState<Board | null>(null);
  const [restoring, setRestoring] = useState<Board | null>(null);
  const incoming = (location.state as BoardsLocationState | null)?.notice;
  const [notice, setNotice] = useState<string | undefined>(incoming);

  // Show an incoming notice once; drop it from history so reloads don't repeat it.
  useEffect(() => {
    if (!incoming) return;
    const { pathname, search, hash } = location;
    navigate({ pathname, search, hash }, { replace: true, state: null });
  }, [incoming, location, navigate]);

  const loaded = useMemo(
    () =>
      (boards.data ?? []).filter(
        (board) => board.isArchived === (status === 'archived'),
      ),
    [boards.data, status],
  );
  const query = search.trim().toLowerCase();
  const visible = query
    ? loaded.filter((board) => matches(board, query))
    : loaded;
  // The dashed "create" tile follows the last board, except in search results.
  const tiles: (Board | typeof CREATE_TILE)[] =
    query || status === 'archived' ? visible : [...visible, CREATE_TILE];
  const shown = paginate(tiles, page, fit.pageSize);

  const openCreate = () => {
    setNotice(undefined);
    setCreating(true);
  };
  const changeSearch = (value: string) => {
    setSearches((current) => ({ ...current, [status]: value }));
    setPage(1);
  };
  const changeStatus = (next: 'active' | 'archived') => {
    const params = new URLSearchParams(location.search);
    params.delete('page');
    if (next === 'archived') params.set('status', next);
    else params.delete('status');
    navigate({ pathname: location.pathname, search: params.toString() });
  };

  return (
    <PageContainer fill>
      <PageHeader
        title="Boards"
        description="Organize your work with Kanban boards for different projects and teams."
        actions={
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
            {status === 'active' && (
              <Button onClick={openCreate}>
                <PlusIcon aria-hidden="true" className="size-4.5" />
                New Board
              </Button>
            )}
          </>
        }
      />

      <nav aria-label="Board status" className="mt-5 flex gap-2">
        <Button
          variant={status === 'active' ? 'primary' : 'secondary'}
          aria-current={status === 'active' ? 'page' : undefined}
          onClick={() => changeStatus('active')}
        >
          Active
        </Button>
        <Button
          variant={status === 'archived' ? 'primary' : 'secondary'}
          aria-current={status === 'archived' ? 'page' : undefined}
          onClick={() => changeStatus('archived')}
        >
          Archived
        </Button>
      </nav>

      {notice && (
        <div className="mt-4">
          <Alert variant="success">{notice}</Alert>
        </div>
      )}

      {/* Fills the remaining height; the page size is however many rows fit here. */}
      <div ref={fit.ref} className="mt-5 min-h-0 flex-1">
        {boards.isPending ? (
          <LoadingState
            label={
              status === 'archived'
                ? 'Loading archived boards…'
                : 'Loading boards…'
            }
          />
        ) : boards.isError && !boards.data ? (
          <ErrorState
            title={
              status === 'archived'
                ? "We couldn't load archived boards"
                : "We couldn't load your boards"
            }
            description="Check your connection and try again."
            onRetry={() => void boards.refetch()}
          />
        ) : loaded.length === 0 ? (
          <EmptyState
            icon={<FolderIcon />}
            title={
              status === 'archived' ? 'No archived boards' : 'No boards yet'
            }
            description={
              status === 'archived'
                ? 'Boards you belong to will appear here when archived.'
                : 'Create your first board, or ask a board owner to add you.'
            }
            action={
              status === 'active' ? (
                <Button onClick={openCreate}>Create board</Button>
              ) : undefined
            }
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
            {shown.items.map((tile) =>
              tile === CREATE_TILE ? (
                <li key="create" data-fit-row className="flex">
                  <CreateBoardTile onClick={openCreate} />
                </li>
              ) : (
                <li key={tile.id} data-fit-row className="flex">
                  <BoardCard
                    board={tile}
                    // UI hint only: the backend enforces OWNER-only actions.
                    onEdit={
                      status === 'active' &&
                      tile.currentUserRole === BoardRole.OWNER
                        ? () => setEditing(tile)
                        : undefined
                    }
                    onArchive={
                      status === 'active' &&
                      tile.currentUserRole === BoardRole.OWNER
                        ? () => setArchiving(tile)
                        : undefined
                    }
                    onRestore={
                      status === 'archived' &&
                      tile.currentUserRole === BoardRole.OWNER
                        ? () => setRestoring(tile)
                        : undefined
                    }
                  />
                </li>
              ),
            )}
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
      {restoring && (
        <RestoreBoardDialog
          board={restoring}
          open
          onClose={() => setRestoring(null)}
          onRestored={(board) => {
            setRestoring(null);
            setNotice(`Board “${board.name}” restored.`);
          }}
        />
      )}
    </PageContainer>
  );
}
