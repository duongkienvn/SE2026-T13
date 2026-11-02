import { useId } from 'react';
import { SoonBadge } from '../../../app/layout/SoonBadge';
import { Button } from '../../../components/Button';
import { ColumnsIcon, SlidersIcon } from '../../../components/icons';
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
  const hintId = useId();
  const statusStyle =
    'inline-flex min-h-11 items-center justify-center gap-1.5 border-b-2 px-3 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed';
  return (
    <div className="space-y-4">
      <div
        aria-label="Board status"
        role="group"
        className="grid grid-cols-2 border-b border-line sm:flex sm:flex-wrap sm:gap-2"
      >
        <button
          type="button"
          disabled={!available || !features.status}
          aria-pressed={
            control.filters.status === 'active' && !control.filters.view
          }
          onClick={() => control.status('active')}
          className={`${statusStyle} ${control.filters.status === 'active' && !control.filters.view ? 'border-primary font-medium text-primary' : 'border-transparent text-muted'}`}
        >
          {personal ? 'Active' : 'All Boards'}
        </button>
        {features.discovery &&
          (['recent', 'starred'] as const).map((view) => (
            <button
              key={view}
              type="button"
              disabled={!available}
              aria-pressed={control.filters.view === view}
              onClick={() => control.view(view)}
              className={`${statusStyle} ${control.filters.view === view ? 'border-primary font-medium text-primary' : 'border-transparent text-muted'}`}
            >
              {view === 'recent' ? 'Recent' : 'Starred'}
            </button>
          ))}
        <button
          type="button"
          disabled={!available || !features.status}
          aria-pressed={control.filters.status === 'archived'}
          onClick={() => control.status('archived')}
          className={`${statusStyle} ${control.filters.status === 'archived' ? 'border-primary font-medium text-primary' : 'border-transparent text-muted'}`}
        >
          Archived
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchField
          label={personal ? 'Search boards' : 'Search workspace boards'}
          placeholder="Search boards…"
          value={control.draft}
          onChange={control.search}
          disabled={!available || !features.search}
          describedBy={hintId}
          className="min-w-0 flex-1 basis-full [&_input]:h-11 sm:basis-52"
        />
        <span
          aria-disabled="true"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-xs text-muted"
        >
          <SlidersIcon className="size-4" />
          Filter
          <SoonBadge />
          <span className="sr-only">Advanced filters, coming soon</span>
        </span>
        <label className="relative min-w-0">
          <span className="sr-only">
            {personal ? 'Sort boards' : 'Sort workspace boards'}
          </span>
          <select
            name="sort"
            aria-describedby={hintId}
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
            className="h-11 max-w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-muted"
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
        <div
          role="group"
          aria-label="Board presentation"
          className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-line bg-surface"
        >
          <span
            role="img"
            className="grid size-11 place-items-center rounded-l-lg bg-primary-soft text-primary"
            aria-label="Grid view selected"
          >
            <ColumnsIcon className="size-4" />
          </span>
          <span
            aria-disabled="true"
            className="flex min-h-11 items-center gap-1 px-2 text-xs text-muted"
          >
            List
            <SoonBadge />
            <span className="sr-only">, coming soon</span>
          </span>
        </div>
        {control.filtered && (
          <Button variant="secondary" size="lg" onClick={control.clear}>
            Clear filters
          </Button>
        )}
      </div>
      <p id={hintId} className="text-xs leading-relaxed text-muted">
        {available
          ? 'Search, status and sorting use server results. List view is coming soon.'
          : 'Search, status, sorting and pagination are unavailable until Workspace services are connected.'}
      </p>
    </div>
  );
}
