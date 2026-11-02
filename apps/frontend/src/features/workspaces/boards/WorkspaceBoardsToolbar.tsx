import { Button } from '../../../components/Button';
import { SearchField } from '../../../components/SearchField';
import type { WorkspaceBoardsGateway } from './types';
import type { useBoardFilters } from './useBoardFilters';

export function WorkspaceBoardsToolbar({
  control,
  features,
  available,
  personal = false,
}: {
  control: ReturnType<typeof useBoardFilters>;
  features: WorkspaceBoardsGateway['features'];
  available: boolean;
  personal?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-3">
      {!personal && (
        <div
          role="group"
          aria-label="Board status"
          className="flex max-w-full gap-1 overflow-x-auto border-b border-line pb-1"
        >
          {(['active', 'recent', 'starred', 'archived'] as const)
            .filter(
              (value) =>
                features.discovery ||
                value === 'active' ||
                value === 'archived',
            )
            .map((value) => {
              const selected =
                value === 'recent' || value === 'starred'
                  ? control.filters.view === value
                  : control.filters.status === value && !control.filters.view;
              return (
                <button
                  type="button"
                  key={value}
                  disabled={!available || !features.status}
                  aria-pressed={selected}
                  onClick={() =>
                    value === 'recent' || value === 'starred'
                      ? control.view(value)
                      : control.status(value)
                  }
                  className={`min-h-10 shrink-0 whitespace-nowrap rounded-lg px-3 text-xs font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${selected ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-app'}`}
                >
                  {value === 'active'
                    ? 'All Boards'
                    : value === 'recent'
                      ? 'Recent'
                      : value === 'starred'
                        ? 'Starred'
                        : 'Archived'}
                </button>
              );
            })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchField
          label={personal ? 'Search boards' : 'Search workspace boards'}
          placeholder="Search boards…"
          value={control.draft}
          onChange={control.search}
          disabled={!available || !features.search}
          className="min-w-0 flex-1 basis-full [&_input]:h-10 sm:basis-52"
        />
        {personal && (
          <label className="min-w-0">
            <span className="sr-only">Board status</span>
            <select
              aria-label="Board status"
              value={control.filters.status}
              disabled={!available || !features.status}
              onChange={(event) =>
                control.status(
                  event.target.value === 'archived' ? 'archived' : 'active',
                )
              }
              className="h-10 max-w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary"
            >
              <option value="active">Active boards</option>
              <option value="archived">Archived boards</option>
            </select>
          </label>
        )}
        <label className="min-w-0">
          <span className="sr-only">
            {personal ? 'Sort boards' : 'Sort workspace boards'}
          </span>
          <select
            name="sort"
            value={control.filters.sort}
            disabled={!available || !features.sorts.length}
            onChange={(event) =>
              control.sort(
                event.target.value === 'name-asc'
                  ? 'name-asc'
                  : event.target.value === 'recent'
                    ? 'recent'
                    : 'updated-desc',
              )
            }
            className="h-10 max-w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:text-muted"
          >
            <option
              value="updated-desc"
              disabled={!features.sorts.includes('updated-desc')}
            >
              Last updated
            </option>
            <option
              value="name-asc"
              disabled={!features.sorts.includes('name-asc')}
            >
              Name A–Z
            </option>
            <option
              value="recent"
              disabled={!features.sorts.includes('recent')}
            >
              Recently viewed
            </option>
          </select>
        </label>
        {control.filtered && (
          <Button variant="secondary" onClick={control.clear}>
            Clear filters
          </Button>
        )}
      </div>
      {!available && (
        <p className="text-xs text-muted">
          Search, status, sorting and pagination are unavailable until Workspace
          services are connected.
        </p>
      )}
    </div>
  );
}
