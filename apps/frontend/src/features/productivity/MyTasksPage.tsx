import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyTasksFilters, TaskGroup } from '@kanban/shared';
import { useEffect, useMemo, useState } from 'react';
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
import { formatCalendarDate, formatInstantDate } from '../settings/format';
import { usePreferences } from '../settings/hooks';
import { useWorkspaceDirectory } from '../workspaces/hooks';
import { nextCalendarDay, startOfDay } from './calendar';
import { useMyTasks } from './hooks';
import { normalizeTaskSearch, parseTaskSearch } from './search';

const groups: { id: TaskGroup; label: string; tone: string }[] = [
  {
    id: 'OVERDUE',
    label: 'Overdue',
    tone: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200',
  },
  {
    id: 'NEXT_7_DAYS',
    label: 'Next 7 days',
    tone: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  },
  {
    id: 'LATER',
    label: 'Later',
    tone: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200',
  },
  { id: 'NO_DUE_DATE', label: 'No due date', tone: 'bg-surface text-muted' },
];
const control =
  'min-h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary';

export function MyTasksPage() {
  usePageTitle('My Tasks');
  const [params, setParams] = useSearchParams();
  const [dateError, setDateError] = useState(false);
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
    setDateError(false);
  }, [search.dueFrom, search.dueTo]);

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
  ) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPage) next.delete('page');
    setParams(next);
  }

  useEffect(() => {
    if (!tasks.tasks) return;
    const last = Math.max(1, tasks.tasks.meta.totalPages);
    if (search.page > last) change({ page: String(last) }, false);
  }, [tasks.tasks, search.page]);

  useEffect(() => {
    if (
      !search.boardId ||
      !boards.isSuccess ||
      boards.isFetching ||
      !scope.isCurrent()
    )
      return;
    if (!selectedBoard) change({ boardId: undefined, labelIds: undefined });
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
      change({ labelIds: kept.join(',') });
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
    change({ boardId: undefined, labelIds: undefined });
  }, [labelAccessLost, search.boardId, queryClient, scope]);

  const reset = () => {
    setDateError(false);
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
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold text-ink">My Tasks</h1>
        <p className="mt-1 text-sm text-muted">
          Cards assigned to you across your boards.
        </p>
        <nav
          aria-label="Task groups"
          className="mt-5 flex gap-5 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {[{ id: 'ALL', label: 'All Tasks' }, ...groups].map((group) => (
            <button
              key={group.id}
              type="button"
              aria-current={search.group === group.id ? 'page' : undefined}
              onClick={() =>
                change({ group: group.id === 'ALL' ? undefined : group.id })
              }
              className={`shrink-0 border-b-2 px-1 py-3 text-sm font-medium ${search.group === group.id ? 'border-primary text-primary' : 'border-transparent text-muted'}`}
            >
              {group.label}
              {data &&
                ` (${group.id === 'ALL' ? total : data.groupCounts[group.id as TaskGroup]})`}
            </button>
          ))}
        </nav>
        <details className="mt-4 rounded-lg border border-line bg-surface p-4">
          <summary className="cursor-pointer font-medium text-ink">
            Filters and sorting
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm text-muted">
              Workspace
              <select
                className={control}
                value={search.workspaceId ?? ''}
                onChange={(event) =>
                  change({
                    workspaceId: event.target.value,
                    boardId: undefined,
                    labelIds: undefined,
                  })
                }
              >
                <option value="">All workspaces</option>
                {directory.workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-muted">
              Board
              <select
                className={control}
                value={selectedBoard ? search.boardId : ''}
                disabled={!boards.isSuccess || boards.isFetching}
                onChange={(event) =>
                  change({ boardId: event.target.value, labelIds: undefined })
                }
              >
                <option value="">All boards</option>
                {boardOptions.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-muted">
              Sort by
              <select
                className={control}
                value={search.sort}
                onChange={(event) =>
                  change({
                    sort:
                      event.target.value === 'dueDate'
                        ? undefined
                        : event.target.value,
                  })
                }
              >
                <option value="dueDate">Due date</option>
                <option value="updatedAt">Recently updated</option>
                <option value="board">Board</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3 sm:col-span-2">
              <label className="min-w-0 text-sm text-muted">
                Due from
                <input
                  className={`${control} min-w-0`}
                  type="date"
                  value={search.dueFrom ?? ''}
                  max={search.dueTo}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value && search.dueTo && value > search.dueTo) {
                      setDateError(true);
                      return;
                    }
                    setDateError(false);
                    change({ dueFrom: value });
                  }}
                />
              </label>
              <label className="min-w-0 text-sm text-muted">
                Due through
                <input
                  className={`${control} min-w-0`}
                  type="date"
                  value={search.dueTo ?? ''}
                  min={search.dueFrom}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value && search.dueFrom && value < search.dueFrom) {
                      setDateError(true);
                      return;
                    }
                    setDateError(false);
                    change({ dueTo: value });
                  }}
                />
              </label>
            </div>
            <div>
              <span className="text-sm text-muted">Labels (match any)</span>
              {!search.boardId ? (
                <p className="mt-2 text-sm text-muted">
                  Select a Board to filter by labels.
                </p>
              ) : labels.isSuccess && !labels.isFetching && selectedBoard ? (
                <select
                  aria-label="Labels (match any)"
                  multiple
                  className={`${control} min-h-24`}
                  value={search.labelIds?.split(',') ?? []}
                  onChange={(event) =>
                    change({
                      labelIds: Array.from(
                        event.target.selectedOptions,
                        (option) => option.value,
                      )
                        .slice(0, 50)
                        .join(','),
                    })
                  }
                >
                  {labels.data.map((label) => (
                    <option key={label.id} value={label.id}>
                      {label.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-2 text-sm text-muted">
                  {labels.isError ? (
                    <>
                      Labels unavailable.{' '}
                      <button
                        type="button"
                        className="text-primary underline"
                        onClick={() => void labels.refetch()}
                      >
                        Retry
                      </button>
                    </>
                  ) : (
                    'Loading labels…'
                  )}
                </p>
              )}
            </div>
          </div>
          {dateError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              The end date must be on or after the start date.
            </p>
          )}
          {preferences.data && (search.dueFrom || search.dueTo) && (
            <p className="mt-3 text-sm text-muted">
              Applied dates:{' '}
              {search.dueFrom
                ? formatCalendarDate(
                    search.dueFrom,
                    preferences.data.dateFormat,
                  )
                : 'Any start'}{' '}
              –{' '}
              {search.dueTo
                ? formatCalendarDate(search.dueTo, preferences.data.dateFormat)
                : 'Any end'}{' '}
              ({timeZone})
            </p>
          )}
          {boards.isError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              Boards are unavailable.{' '}
              <button
                type="button"
                className="underline"
                onClick={() => void boards.refetch()}
              >
                Retry
              </button>
            </p>
          )}
          {directory.state !== 'ready' && directory.state !== 'loading' && (
            <p role="alert" className="mt-3 text-sm text-danger">
              Workspaces are unavailable.{' '}
              <button
                type="button"
                className="underline"
                onClick={() => void directory.refetch()}
              >
                Retry
              </button>
            </p>
          )}
          <button
            type="button"
            className="mt-4 text-sm font-medium text-primary"
            onClick={reset}
          >
            Reset filters
          </button>
        </details>
        {invalidRange ? (
          <p role="alert" className="mt-6 text-danger">
            This date range has no valid local time in {timeZone}. Choose
            another date.
          </p>
        ) : preferences.fetchStatus === 'paused' ||
          tasks.fetchStatus === 'paused' ? (
          <p role="status" className="mt-6 text-muted">
            You appear to be offline. Tasks will reload when you reconnect.
          </p>
        ) : preferences.isError || tasks.isError ? (
          <div role="alert" className="mt-6 text-ink">
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
        ) : !data ? (
          <p role="status" className="mt-6 text-muted">
            Loading tasks…
          </p>
        ) : search.page > Math.max(1, data.meta.totalPages) ? (
          <p role="status" className="mt-6 text-muted">
            Updating page…
          </p>
        ) : data.data.length === 0 ? (
          <div className="mt-8 text-center">
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
          <div className="mt-5 space-y-3">
            {groups
              .filter(
                (group) =>
                  (search.group === 'ALL' || search.group === group.id) &&
                  data.data.some((task) => task.group === group.id),
              )
              .map((group) => (
                <section
                  key={group.id}
                  aria-labelledby={`task-${group.id}`}
                  className="overflow-hidden rounded-lg border border-line"
                >
                  <h2
                    id={`task-${group.id}`}
                    className={`px-3 py-1.5 text-sm font-semibold ${group.tone}`}
                  >
                    {group.label} ({data.groupCounts[group.id]})
                  </h2>
                  <ul>
                    {data.data
                      .filter((task) => task.group === group.id)
                      .map((task) => (
                        <li
                          key={task.id}
                          className="border-t border-line bg-surface"
                        >
                          <Link
                            to={task.permalink}
                            className="flex min-h-12 flex-wrap items-center justify-between gap-2 px-3 py-2 hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-primary"
                          >
                            <span className="min-w-0">
                              <span className="block break-words text-sm font-medium text-ink">
                                {task.title}
                              </span>
                              <span className="mt-0.5 block break-words text-xs text-muted">
                                {task.boardName} · {task.workspaceName}
                              </span>
                              {task.labels.length > 0 && (
                                <span className="mt-2 flex flex-wrap gap-1">
                                  {task.labels.slice(0, 5).map((label) => (
                                    <span
                                      key={label.id}
                                      className="max-w-full break-all rounded border px-2 py-0.5 text-xs text-ink"
                                      style={{ borderColor: label.color }}
                                    >
                                      {label.name}
                                    </span>
                                  ))}
                                  {task.labels.length > 5 && (
                                    <span className="text-xs text-muted">
                                      +{task.labels.length - 5}
                                    </span>
                                  )}
                                </span>
                              )}
                            </span>
                            {task.dueDate && preferences.data ? (
                              <time
                                dateTime={task.dueDate}
                                className={`shrink-0 text-xs ${task.group === 'OVERDUE' ? 'text-danger' : task.group === 'NEXT_7_DAYS' ? 'text-amber-800 dark:text-amber-200' : 'text-muted'}`}
                              >
                                {formatInstantDate(
                                  new Date(task.dueDate),
                                  preferences.data.dateFormat,
                                  timeZone,
                                )}
                              </time>
                            ) : (
                              <span className="shrink-0 text-xs text-muted">
                                No due date
                              </span>
                            )}
                          </Link>
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
          </div>
        )}
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
