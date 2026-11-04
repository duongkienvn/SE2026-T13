import { useEffect, useState } from 'react';
import { SlidersIcon, TagIcon } from '../../components/icons';
import type { useLabelCatalog } from '../labels/hooks';
import type { useWorkspaceDirectory } from '../workspaces/hooks';
import type { TaskSearch } from './search';

const control =
  'min-h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary';

interface TaskFiltersProps {
  search: TaskSearch;
  change: (changes: Record<string, string | undefined>) => void;
  onReset: () => void;
  boardOptions: { id: string; name: string }[];
  selectedBoard: boolean;
  boardsPending: boolean;
  boardsFailed: boolean;
  retryBoards: () => void;
  directory: ReturnType<typeof useWorkspaceDirectory>;
  labels: ReturnType<typeof useLabelCatalog>;
}

export function TaskFilters({
  search,
  change,
  onReset,
  boardOptions,
  selectedBoard,
  boardsPending,
  boardsFailed,
  retryBoards,
  directory,
  labels,
}: TaskFiltersProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateError, setDateError] = useState(false);
  useEffect(() => {
    setDateError(false);
  }, [search.dueFrom, search.dueTo]);
  const activeFilterCount = [
    search.workspaceId,
    search.boardId,
    search.labelIds,
    search.dueFrom,
    search.dueTo,
  ].filter(Boolean).length;
  const filtered = activeFilterCount > 0 || search.group !== 'ALL';
  const reset = () => {
    setDateError(false);
    onReset();
  };
  return (
    <>
      <div
        className={`my-tasks-toolbar ${filtersOpen ? 'my-tasks-toolbar-expanded' : ''}`}
      >
        <button
          type="button"
          className="my-tasks-filter-button"
          aria-expanded={filtersOpen}
          aria-controls="task-advanced-filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <SlidersIcon /> Filters
          {activeFilterCount > 0 && (
            <span
              className="my-tasks-filter-count"
              aria-label={`${activeFilterCount} active ${activeFilterCount === 1 ? 'filter' : 'filters'}`}
            >
              {activeFilterCount}
            </span>
          )}
        </button>
        <div className="my-tasks-quick-filters">
          <label className="my-tasks-select">
            <span aria-hidden="true">Workspace:</span>
            <select
              className={control}
              aria-label="Workspace"
              value={search.workspaceId ?? ''}
              onChange={(event) =>
                change({
                  workspaceId: event.target.value,
                  boardId: undefined,
                  labelIds: undefined,
                })
              }
            >
              <option value="">All</option>
              {directory.workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
          <label className="my-tasks-select">
            <span aria-hidden="true">Board:</span>
            <select
              className={control}
              aria-label="Board"
              value={selectedBoard ? search.boardId : ''}
              disabled={boardsPending}
              onChange={(event) =>
                change({ boardId: event.target.value, labelIds: undefined })
              }
            >
              <option value="">All</option>
              {boardOptions.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          className="my-tasks-label-button"
          aria-expanded={filtersOpen}
          aria-controls="task-advanced-filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <TagIcon /> Labels:{' '}
          {search.labelIds ? search.labelIds.split(',').length : 'All'}
        </button>
        <label className="my-tasks-select my-tasks-sort">
          <span aria-hidden="true">Sort:</span>
          <select
            className={control}
            aria-label="Sort by"
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
            <option value="dueDate">Due date (earliest)</option>
            <option value="updatedAt">Recently updated</option>
            <option value="board">Board</option>
          </select>
        </label>
        {(filtered || search.sort !== 'dueDate') && (
          <button type="button" className="my-tasks-reset" onClick={reset}>
            Reset filters
          </button>
        )}
      </div>
      <div
        id="task-advanced-filters"
        hidden={!filtersOpen}
        className="my-tasks-advanced"
      >
        <div className="my-tasks-advanced-grid">
          <div className="grid min-w-0 grid-cols-2 gap-3">
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
        {boardsFailed && (
          <p role="alert" className="mt-3 text-sm text-danger">
            Boards are unavailable.{' '}
            <button
              type="button"
              className="underline"
              onClick={() => retryBoards()}
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
      </div>
    </>
  );
}
