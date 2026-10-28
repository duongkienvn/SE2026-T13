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
}: {
  control: ReturnType<typeof useBoardFilters>;
  features: WorkspaceBoardsGateway['features'];
  available: boolean;
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
          aria-pressed={control.filters.status === 'active'}
          onClick={() => control.status('active')}
          className={`${statusStyle} ${control.filters.status === 'active' ? 'border-primary font-medium text-primary' : 'border-transparent text-muted'}`}
        >
          All Boards
        </button>
        {['Recent', 'Starred'].map((label) => (
          <span
            key={label}
            aria-disabled="true"
            className={`${statusStyle} border-transparent text-muted`}
          >
            {label}
            <SoonBadge />
            <span className="sr-only">, coming soon</span>
          </span>
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
          label="Search workspace boards"
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
          <span className="sr-only">Sort workspace boards</span>
          <select
            name="sort"
            aria-describedby={hintId}
            value={control.filters.sort}
            disabled={!available || !features.sorts.length}
            onChange={(event) =>
              control.sort(
                event.target.value === 'name-asc' ? 'name-asc' : 'updated-desc',
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
          ? 'Search, status and sorting use the workspace’s supported server capabilities. Recent, Starred and List view are coming soon.'
          : 'Search, status, sorting and pagination are unavailable until Workspace services are connected.'}
      </p>
    </div>
  );
}
