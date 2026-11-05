import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyTasksFilters } from '@kanban/shared';
import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PageContainer } from '../../components/PageContainer';
import { Pagination } from '../../components/Pagination';
import { usePageTitle } from '../../hooks/usePageTitle';
import { isApiError } from '../../lib/api-client';
import { useAuthSession } from '../auth/auth-session-context';
import { useAuth } from '../auth/useAuth';
import { listAllBoards } from '../boards/api';
import { revokeBoardAccess } from '../boards/revoke-board-access';
import { useLabelCatalog } from '../labels/hooks';
import { formatCalendarDate } from '../settings/format';
import { usePreferences } from '../settings/hooks';
import { useWorkspaceDirectory } from '../workspaces/hooks';
import { nextCalendarDay, startOfDay } from './calendar';
import { useMyTasks } from './hooks';
import { normalizeTaskSearch, parseTaskSearch } from './search';
import { CheckSquareIcon, LayersIcon } from '../../components/icons';
import { TaskFilters } from './TaskFilters';
import { TaskSections } from './TaskSections';
import { taskGroups } from './task-groups';
import './my-tasks.css';

export function MyTasksPage() {
  usePageTitle('My Tasks');
  const [params, setParams] = useSearchParams();
  const search = useMemo(() => parseTaskSearch(params), [params]);
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const queryClient = useQueryClient();
  const preferences = usePreferences();
  const directory = useWorkspaceDirectory();
  const boards = useQuery({
    queryKey: ['productivity', 'board-options', user?.id, scope.generation],
    queryFn: ({ signal }) =>
      runAuthorized((token) => listAllBoards(token, signal)),
    enabled: !!user,
    gcTime: 0,
    retry: false,
    refetchOnMount: 'always',
  });
  const boardOptions =
    boards.isSuccess && !boards.isFetching && scope.isCurrent()
      ? boards.data.filter(
          (board) =>
            !search.workspaceId || board.workspaceId === search.workspaceId,
        )
      : [];
  const selectedBoard = boardOptions.some(
    (board) => board.id === search.boardId,
  );
  const labels = useLabelCatalog(search.boardId ?? '', {
    enabled: selectedBoard,
  });
  const labelAccessLost =
    selectedBoard &&
    labels.isError &&
    isApiError(labels.error) &&
    [403, 404].includes(labels.error.status);
  const timeZone = preferences.data?.timeZone ?? 'UTC';
  const filters = useMemo<MyTasksFilters>(
    () => ({
      group: search.group,
      page: search.page,
      sort: search.sort,
      workspaceId: search.workspaceId,
      boardId: search.boardId,
      labelIds: search.labelIds,
      dueFrom: search.dueFrom
        ? startOfDay(search.dueFrom, timeZone)
        : undefined,
      dueTo: search.dueTo
        ? startOfDay(nextCalendarDay(search.dueTo), timeZone)
        : undefined,
    }),
    [search, timeZone],
  );
  const invalidRange = !!(
    filters.dueFrom &&
    filters.dueTo &&
    filters.dueFrom >= filters.dueTo
  );
  const tasks = useMyTasks(
    filters,
    timeZone,
    preferences.isSuccess && !invalidRange,
  );

  useEffect(() => {
    const normalized = normalizeTaskSearch(params);
    if (normalized.toString() !== params.toString())
      setParams(normalized, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    if (search.page === 1) return;
    return queryClient.getQueryCache().subscribe((event) => {
      const key = event.query.queryKey;
      if (
        event.type !== 'updated' ||
        event.action.type !== 'invalidate' ||
        event.query.getObserversCount() === 0 ||
        key[0] !== 'productivity' ||
        key[1] !== 'tasks' ||
        key[2] !== user?.id ||
        key[3] !== scope.generation
      )
        return;
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    });
  }, [queryClient, scope.generation, search.page, setParams, user?.id]);

  function change(
    changes: Record<string, string | undefined>,
    resetPage = true,
    replace = false,
  ) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace });
  }

  useEffect(() => {
    if (!tasks.tasks) return;
    const last = Math.max(1, tasks.tasks.meta.totalPages);
    if (search.page > last) change({ page: String(last) }, false, true);
  }, [tasks.tasks, search.page]);

  useEffect(() => {
    if (
      !search.boardId ||
      !boards.isSuccess ||
      boards.isFetching ||
      !scope.isCurrent()
    )
      return;
    if (!selectedBoard)
      change({ boardId: undefined, labelIds: undefined }, true, true);
  }, [
    boards.isSuccess,
    boards.isFetching,
    boards.data,
    search.boardId,
    selectedBoard,
    scope,
  ]);

  useEffect(() => {
    if (
      !selectedBoard ||
      !labels.isSuccess ||
      labels.isFetching ||
      !search.labelIds
    )
      return;
    const allowed = new Set(labels.data.map((label) => label.id.toLowerCase()));
    const kept = search.labelIds.split(',').filter((id) => allowed.has(id));
    if (kept.length !== search.labelIds.split(',').length)
      change({ labelIds: kept.join(',') }, true, true);
  }, [
    labels.isSuccess,
    labels.isFetching,
    labels.data,
    selectedBoard,
    search.labelIds,
  ]);

  useEffect(() => {
    if (!labelAccessLost || !search.boardId || !scope.isCurrent()) return;
    revokeBoardAccess(queryClient, search.boardId);
    change({ boardId: undefined, labelIds: undefined }, true, true);
  }, [labelAccessLost, search.boardId, queryClient, scope]);

  const reset = () => {
    change({
      group: undefined,
      sort: undefined,
      workspaceId: undefined,
      boardId: undefined,
      labelIds: undefined,
      dueFrom: undefined,
      dueTo: undefined,
    });
  };
  const filtered =
    search.group !== 'ALL' ||
    !!(
      search.workspaceId ||
      search.boardId ||
      search.labelIds ||
      search.dueFrom ||
      search.dueTo
    );
  const data = labelAccessLost ? undefined : tasks.tasks;
  const taskError = isApiError(tasks.error) ? tasks.error : undefined;
  const errorMessage =
    taskError?.status === 0
      ? 'You appear to be offline. Reconnect and try again.'
      : taskError && [403, 404].includes(taskError.status)
        ? 'Your access may have changed. Reload your tasks.'
        : 'Tasks are unavailable.';
  const total = data
    ? Object.values(data.groupCounts).reduce((sum, count) => sum + count, 0)
    : undefined;
  return (
    <PageContainer>
      <div className="my-tasks-page">
        <header className="my-tasks-header">
          <span className="my-tasks-header-icon">
            <CheckSquareIcon />
          </span>
          <div>
            <h1>My Tasks</h1>
            <p>Cards assigned to you across your boards.</p>
          </div>
        </header>
        <nav aria-label="Task groups" className="my-tasks-tabs">
          {[
            { id: 'ALL', label: 'All Tasks', Icon: LayersIcon },
            ...taskGroups,
          ].map((group) => (
            <button
              key={group.id}
              type="button"
              aria-current={search.group === group.id ? 'page' : undefined}
              onClick={() =>
                change({ group: group.id === 'ALL' ? undefined : group.id })
              }
              className="my-tasks-tab"
            >
              <group.Icon />
              {group.label}
              {data &&
                ` (${group.id === 'ALL' ? total : data.groupCounts[group.id as keyof typeof data.groupCounts]})`}
            </button>
          ))}
        </nav>
        <TaskFilters
          search={search}
          change={change}
          onReset={reset}
          boardOptions={boardOptions}
          selectedBoard={selectedBoard}
          boardsPending={!boards.isSuccess || boards.isFetching}
          boardsFailed={boards.isError}
          retryBoards={() => void boards.refetch()}
          directory={directory}
          labels={labels}
        />
        {preferences.data && (search.dueFrom || search.dueTo) && (
          <p className="mt-3 text-sm text-muted">
            Applied dates:{' '}
            {search.dueFrom
              ? formatCalendarDate(search.dueFrom, preferences.data.dateFormat)
              : 'Any start'}{' '}
            –{' '}
            {search.dueTo
              ? formatCalendarDate(search.dueTo, preferences.data.dateFormat)
              : 'Any end'}{' '}
            ({timeZone})
          </p>
        )}
        <div className="my-tasks-results">
          {invalidRange ? (
            <p role="alert" className="my-tasks-notice text-danger">
              This date range has no valid local time in {timeZone}. Choose
              another date.
            </p>
          ) : preferences.fetchStatus === 'paused' ||
            tasks.fetchStatus === 'paused' ? (
            <p role="status" className="my-tasks-notice text-muted">
              You appear to be offline. Tasks will reload when you reconnect.
            </p>
          ) : preferences.isError || tasks.isError ? (
            <div role="alert" className="my-tasks-notice text-ink">
              {errorMessage}{' '}
              <button
                type="button"
                className="text-primary underline"
                onClick={() => {
                  void preferences.refetch();
                  void tasks.refetch();
                }}
              >
                Retry
              </button>
            </div>
          ) : !data || !preferences.data ? (
            <p role="status" className="my-tasks-notice text-muted">
              Loading tasks…
            </p>
          ) : search.page > Math.max(1, data.meta.totalPages) ? (
            <p role="status" className="my-tasks-notice text-muted">
              Updating page…
            </p>
          ) : data.data.length === 0 ? (
            <div className="my-tasks-empty">
              <span className="my-tasks-empty-icon">
                <CheckSquareIcon />
              </span>
              <h2 className="font-semibold text-ink">
                {filtered ? 'No matching tasks' : 'No assigned tasks yet'}
              </h2>
              <p className="mt-2 text-sm text-muted">
                {filtered
                  ? 'Try changing your filters.'
                  : 'Cards assigned to you will appear here.'}
              </p>
              {filtered ? (
                <button
                  type="button"
                  className="mt-3 text-primary"
                  onClick={reset}
                >
                  Reset filters
                </button>
              ) : (
                <Link className="mt-3 inline-block text-primary" to="/boards">
                  Browse boards
                </Link>
              )}
            </div>
          ) : (
            <TaskSections
              tasks={data.data}
              counts={data.groupCounts}
              group={search.group}
              dateFormat={preferences.data.dateFormat}
              timeZone={timeZone}
            />
          )}
        </div>
        {data && (
          <>
            <p className="mt-4 text-sm text-muted" role="status">
              {data.meta.total} {data.meta.total === 1 ? 'task' : 'tasks'}
            </p>
            <Pagination
              label="Task pages"
              page={data.meta.page}
              pageCount={data.meta.totalPages}
              onChange={(page) => change({ page: String(page) }, false)}
            />
          </>
        )}
      </div>
    </PageContainer>
  );
}
