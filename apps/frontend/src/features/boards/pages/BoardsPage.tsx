import { BoardRole } from '@kanban/shared';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { FolderIcon, PlusIcon } from '../../../components/icons';
import { PageContainer } from '../../../components/PageContainer';
import { PageHeader } from '../../../components/PageHeader';
import { SearchField } from '../../../components/SearchField';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../../components/states';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { ArchiveBoardDialog } from '../components/ArchiveBoardDialog';
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

function matches(board: Board, query: string): boolean {
  const text = `${board.name} ${board.description ?? ''}`.toLowerCase();
  return text.includes(query);
}

export function BoardsPage() {
  usePageTitle('Boards');
  const boards = useBoards();
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
    () =>
      (boards.data?.pages.flatMap((page) => page.items) ?? []).filter(
        (board) => !board.isArchived,
      ),
    [boards.data],
  );
  const query = search.trim().toLowerCase();
  // Client-side only: searches the boards loaded so far.
  const visible = query
    ? loaded.filter((board) => matches(board, query))
    : loaded;

  const openCreate = () => {
    setNotice(undefined);
    setCreating(true);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Boards"
        description="Organize your work with Kanban boards for different projects and teams."
        actions={
          <>
            {loaded.length > 0 && (
              <SearchField
                label="Search boards"
                placeholder="Search boards..."
                value={search}
                onChange={setSearch}
                className="w-full sm:w-[306px]"
              />
            )}
            <Button size="lg" onClick={openCreate}>
              <PlusIcon aria-hidden="true" className="size-5" />
              New Board
            </Button>
          </>
        }
      />

      {notice && (
        <div className="mt-6">
          <Alert variant="success">{notice}</Alert>
        </div>
      )}

      <div className="mt-8">
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
            description={`No loaded board matches “${search.trim()}”.`}
          />
        ) : (
          <ul className="grid grid-cols-1 gap-7 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((board) => {
              // UI hint only: the backend enforces OWNER-only actions.
              const isOwner = board.currentUserRole === BoardRole.OWNER;
              return (
                <li key={board.id} className="flex">
                  <BoardCard
                    board={board}
                    onEdit={isOwner ? () => setEditing(board) : undefined}
                    onArchive={isOwner ? () => setArchiving(board) : undefined}
                  />
                </li>
              );
            })}
            {!query && (
              <li className="flex">
                <CreateBoardTile onClick={openCreate} />
              </li>
            )}
          </ul>
        )}

        {boards.isFetchNextPageError && (
          <div className="mt-8">
            <Alert variant="error">
              We couldn't load more boards. Try again.
            </Alert>
          </div>
        )}
        {boards.hasNextPage && (
          <div className="mt-8 flex justify-center">
            <Button
              variant="secondary"
              disabled={boards.isFetchingNextPage}
              onClick={() => void boards.fetchNextPage()}
            >
              {boards.isFetchingNextPage ? 'Loading…' : 'Load more boards'}
            </Button>
          </div>
        )}
      </div>

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
