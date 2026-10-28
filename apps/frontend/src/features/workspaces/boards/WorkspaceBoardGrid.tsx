import type { ReactNode } from 'react';
import { ColumnsIcon } from '../../../components/icons';
import type { WorkspaceViewState } from '../types';
import type { WorkspaceBoardSummary } from './types';
import { WorkspaceBoardCard } from './WorkspaceBoardCard';

export function WorkspaceBoardGrid({
  boards,
  state,
  filtered = false,
  actions,
}: {
  boards: WorkspaceBoardSummary[];
  state: WorkspaceViewState;
  filtered?: boolean;
  actions?: (board: WorkspaceBoardSummary) => ReactNode;
}) {
  const grid = 'grid grid-cols-1 gap-4 min-[640px]:grid-cols-2 xl:grid-cols-3';
  if (state === 'loading')
    return (
      <div role="status">
        <span className="sr-only">Loading workspace boards</span>
        <div aria-hidden="true" className={`${grid} motion-safe:animate-pulse`}>
          {[1, 2, 3, 4, 5, 6].map((key) => (
            <div
              key={key}
              className="rounded-xl border border-line bg-surface p-2"
            >
              <div className="h-24 rounded-lg bg-line" />
              <div className="space-y-3 px-2 py-4">
                <div className="h-4 w-3/4 rounded bg-line" />
                <div className="h-3 w-1/2 rounded bg-line" />
                <div className="h-3 w-2/3 rounded bg-line" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  if (state === 'ready' && boards.length)
    return (
      <div className={grid}>
        {boards.map((board) => (
          <WorkspaceBoardCard
            key={board.id}
            board={board}
            actions={actions?.(board)}
          />
        ))}
      </div>
    );
  const title =
    state === 'ready'
      ? filtered
        ? 'No matching boards'
        : 'No accessible boards yet'
      : 'Workspace boards unavailable';
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface/60 px-5 py-10 text-center">
      <span className="mb-4 grid size-14 place-items-center rounded-xl bg-primary-soft text-primary">
        <ColumnsIcon className="size-7" />
      </span>
      <h3 className="font-semibold text-ink">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
        {state === 'ready'
          ? filtered
            ? 'Try a different board name or clear your filters.'
            : 'Boards you have access to will appear here. Create a board when workspace policy allows.'
          : 'Your authorized boards will appear here when Workspace services are connected.'}
      </p>
    </div>
  );
}
