import { useMemo, useState } from 'react';
import { Button } from '../../../components/Button';
import { FolderIcon } from '../../../components/icons';
import { PageContainer } from '../../../components/PageContainer';
import { PageHeader } from '../../../components/PageHeader';
import { SearchField } from '../../../components/SearchField';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../../components/states';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { BoardCard } from '../components/BoardCard';
import { useBoards } from '../hooks';
import type { Board } from '../types';

function matches(board: Board, query: string): boolean {
  const text = `${board.name} ${board.description ?? ''}`.toLowerCase();
  return text.includes(query);
}

export function BoardsPage() {
  usePageTitle('Boards');
  const boards = useBoards();
  const [search, setSearch] = useState('');

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

  return (
    <PageContainer>
      <PageHeader
        title="Boards"
        description="Organize your work with Kanban boards for different projects and teams."
        actions={
          loaded.length > 0 && (
            <SearchField
              label="Search boards"
              placeholder="Search boards..."
              value={search}
              onChange={setSearch}
              className="w-full sm:w-[306px]"
            />
          )
        }
      />

      <div className="mt-8">
        {boards.isPending ? (
          <LoadingState label="Loading boards…" />
        ) : boards.isError ? (
          <ErrorState
            title="We couldn't load your boards"
            description="Check your connection and try again."
            onRetry={() => void boards.refetch()}
          />
        ) : loaded.length === 0 ? (
          <EmptyState
            icon={<FolderIcon />}
            title="No boards yet"
            description="Boards you create or are added to will appear here."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No matching boards"
            description={`No loaded board matches “${search.trim()}”.`}
          />
        ) : (
          <ul className="grid grid-cols-1 gap-7 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((board) => (
              <li key={board.id} className="flex">
                <BoardCard board={board} />
              </li>
            ))}
          </ul>
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
    </PageContainer>
  );
}
