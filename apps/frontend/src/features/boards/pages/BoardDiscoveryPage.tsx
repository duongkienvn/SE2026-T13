import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { BoardRole } from '@kanban/shared';
import { Button } from '../../../components/Button';
import { Alert } from '../../../components/Alert';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { PageContainer } from '../../../components/PageContainer';
import { Pagination } from '../../../components/Pagination';
import { apiRequestPage } from '../../../lib/api-client';
import { useAuth } from '../../auth/useAuth';
import { useAuthSession } from '../../auth/auth-session-context';
import { useBoardFilters } from '../../workspaces/boards/useBoardFilters';
import { WorkspaceBoardsToolbar } from '../../workspaces/boards/WorkspaceBoardsToolbar';
import { BoardCard } from '../components/BoardCard';
import {
  CreateBoardDialog,
  EditBoardDialog,
} from '../components/BoardFormDialog';
import { ArchiveBoardDialog } from '../components/ArchiveBoardDialog';
import { RestoreBoardDialog } from '../components/RestoreBoardDialog';
import { BoardsEmptyState } from '../components/BoardsEmptyState';
import type { Board } from '../types';

const features = {
  search: true,
  discovery: true,
  status: true,
  sorts: ['updated-desc', 'name-asc', 'recent'] as const,
  pagination: true,
};

export function BoardDiscoveryPage() {
  usePageTitle('Boards');
  const location = useLocation();
  const navigate = useNavigate();
  const incoming = (location.state as { notice?: string } | null)?.notice;
  const [notice, setNotice] = useState(incoming);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Board | null>(null);
  const [archiving, setArchiving] = useState<Board | null>(null);
  const [restoring, setRestoring] = useState<Board | null>(null);
  useEffect(() => {
    if (incoming)
      void navigate(
        {
          pathname: location.pathname,
          search: location.search,
          hash: location.hash,
        },
        { replace: true, state: null },
      );
  }, [incoming, location.pathname, location.search, location.hash, navigate]);
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const control = useBoardFilters(features);
  const filters = control.filters;
  const result = useQuery({
    queryKey: [
      'boards',
      'list',
      user?.id,
      scope.generation,
      'discovery',
      filters,
    ],
    enabled: !!user && !control.debouncing,
    queryFn: ({ signal }) => {
      const query = new URLSearchParams({
        page: String(filters.page),
        limit: '20',
        status: filters.status,
        sort:
          filters.sort === 'name-asc'
            ? 'name'
            : filters.sort === 'recent'
              ? 'recent'
              : 'updatedAt',
      });
      if (filters.view) query.set(filters.view, 'true');
      if (filters.search) query.set('q', filters.search);
      return runAuthorized((accessToken) =>
        apiRequestPage<Board>(`/boards?${query}`, { accessToken, signal }),
      );
    },
    retry: false,
  });
  // Active results alone cannot distinguish an empty account from archived-only
  // boards. Check a single archived result only when this distinction is needed.
  const checkingEmptyAccount =
    result.isSuccess &&
    !control.debouncing &&
    !filters.search &&
    !filters.view &&
    filters.status === 'active' &&
    result.data.meta.total === 0;
  const archivedBoards = useQuery({
    queryKey: [
      'boards',
      'list',
      user?.id,
      scope.generation,
      'empty-state',
      'archived',
    ],
    enabled: !!user && checkingEmptyAccount,
    queryFn: ({ signal }) =>
      runAuthorized((accessToken) =>
        apiRequestPage<Board>(
          '/boards?page=1&limit=1&status=archived&sort=updatedAt',
          { accessToken, signal },
        ),
      ),
    retry: false,
  });
  const emptyAccount =
    checkingEmptyAccount &&
    !result.isFetching &&
    archivedBoards.isSuccess &&
    !archivedBoards.isFetching &&
    archivedBoards.data.meta.total === 0;
  const checkingArchived =
    checkingEmptyAccount &&
    (result.isFetching ||
      archivedBoards.isPending ||
      archivedBoards.isFetching);
  const archivedCheckFailed = checkingEmptyAccount && archivedBoards.isError;
  useEffect(() => {
    if (!result.isSuccess || control.debouncing) return;
    const lastPage = Math.max(1, result.data.meta.totalPages);
    if (filters.page > lastPage) control.page(lastPage);
  }, [
    result.isSuccess,
    result.data,
    control.debouncing,
    filters.page,
    control.page,
  ]);
  return (
    <PageContainer fill={emptyAccount}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">
            {filters.view === 'starred' ? 'Starred boards' : 'Boards'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Your boards across all workspaces.
          </p>
        </div>
        {filters.status === 'active' &&
          result.isSuccess &&
          (result.data.meta.total > 0 ||
            (checkingEmptyAccount &&
              archivedBoards.data &&
              archivedBoards.data.meta.total > 0)) && (
            <Button onClick={() => setCreating(true)}>Create Board</Button>
          )}
      </div>
      {!emptyAccount && (
        <WorkspaceBoardsToolbar
          control={control}
          features={features}
          available
          personal
        />
      )}
      {notice && (
        <div className="mt-4">
          <Alert variant="success">{notice}</Alert>
        </div>
      )}
      {result.isPending || control.debouncing || checkingArchived ? (
        <p role="status" className="mt-6">
          Loading boards…
        </p>
      ) : result.isError || archivedCheckFailed ? (
        <div role="alert" className="mt-6">
          Boards unavailable.{' '}
          <button
            type="button"
            onClick={() =>
              void (archivedCheckFailed
                ? archivedBoards.refetch()
                : result.refetch())
            }
          >
            Retry
          </button>
        </div>
      ) : emptyAccount ? (
        <BoardsEmptyState onCreate={() => setCreating(true)} />
      ) : (
        <>
          {result.data.items.length ? (
            <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {result.data.items.map((board) => (
                <li key={board.id} className="min-w-0">
                  <BoardCard
                    board={board}
                    stateUpdatedAt={result.dataUpdatedAt}
                    onEdit={
                      !board.isArchived &&
                      board.currentUserRole === BoardRole.OWNER &&
                      board.capabilities?.canManageBoard !== false
                        ? () => setEditing(board)
                        : undefined
                    }
                    onArchive={
                      !board.isArchived &&
                      board.currentUserRole === BoardRole.OWNER &&
                      board.capabilities?.canManageBoard !== false
                        ? () => setArchiving(board)
                        : undefined
                    }
                    onRestore={
                      board.isArchived &&
                      board.currentUserRole === BoardRole.OWNER &&
                      board.capabilities?.canRestoreBoard !== false
                        ? () => setRestoring(board)
                        : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-6 text-center">
              <h2 className="text-lg font-semibold">
                {filters.view === 'starred'
                  ? 'No starred boards'
                  : filters.view === 'recent'
                    ? 'No recently viewed boards'
                    : filters.search
                      ? 'No matching boards'
                      : filters.status === 'archived'
                        ? 'No archived boards'
                        : 'No active boards'}
              </h2>
              {!filters.view &&
                !filters.search &&
                filters.status === 'active' && (
                  <>
                    <p className="mt-2 text-sm text-muted">
                      Your archived boards are available in the status filter.
                    </p>
                    <Button
                      variant="secondary"
                      className="mt-4"
                      onClick={() => control.status('archived')}
                    >
                      View archived boards
                    </Button>
                  </>
                )}
              {control.filtered && (
                <Button
                  variant="secondary"
                  className="mt-4"
                  onClick={control.clear}
                >
                  Reset filters
                </Button>
              )}
            </div>
          )}
          {result.data.meta.total > 0 && (
            <p className="mt-4 text-sm text-muted" role="status">
              {result.data.meta.total} accessible{' '}
              {result.data.meta.total === 1 ? 'board' : 'boards'}
            </p>
          )}
          <Pagination
            label="Board discovery pages"
            page={result.data.meta.page}
            pageCount={result.data.meta.totalPages}
            onChange={control.page}
          />
        </>
      )}
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
