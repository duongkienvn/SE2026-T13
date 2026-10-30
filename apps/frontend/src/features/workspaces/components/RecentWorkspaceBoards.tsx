import { Link, useParams } from 'react-router';
import {
  ArrowRightIcon,
  ColumnsIcon,
  LockIcon,
} from '../../../components/icons';
import { formatRelativeTime } from '../../../lib/format';
import { workspacePath } from '../navigation';
import type { WorkspaceOverview, WorkspaceViewState } from '../types';

export function RecentWorkspaceBoards({
  overview,
  state,
}: {
  overview?: WorkspaceOverview;
  state: WorkspaceViewState;
}) {
  const boards = overview?.recentBoards ?? [];
  const { workspaceId = '' } = useParams();
  return (
    <section
      aria-labelledby="recent-workspace-boards"
      className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5"
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2
          id="recent-workspace-boards"
          className="text-sm font-semibold text-ink"
        >
          Recent Boards
        </h2>
        <Link
          to={`${workspacePath(workspaceId)}/boards`}
          className="flex min-h-11 items-center gap-1.5 rounded text-xs text-primary focus-visible:outline-2 focus-visible:outline-primary"
        >
          View all <ArrowRightIcon className="size-3.5" />
        </Link>
      </header>
      {state === 'loading' ? (
        <div
          aria-label="Loading recent boards"
          className="space-y-5 motion-safe:animate-pulse"
        >
          {[1, 2, 3].map((key) => (
            <div
              key={key}
              aria-hidden="true"
              className="flex items-center gap-3"
            >
              <div className="h-14 w-18 shrink-0 rounded-lg bg-line" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-4/5 rounded bg-line" />
                <div className="h-2.5 w-2/3 rounded bg-line" />
              </div>
            </div>
          ))}
        </div>
      ) : boards.length ? (
        <ul className="divide-y divide-line">
          {boards.map((board) => (
            <li key={board.id}>
              <Link
                to={`/boards/${encodeURIComponent(board.id)}`}
                className="group flex min-h-22 items-center gap-3 rounded-lg py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span
                  aria-hidden="true"
                  className="grid h-14 w-18 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary/20 to-primary-soft text-primary"
                >
                  <ColumnsIcon className="size-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium break-words text-ink group-hover:text-primary [overflow-wrap:anywhere]">
                    {board.name}
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">
                    {board.archived
                      ? 'Archived · Read only · Updated '
                      : 'Updated '}
                    <time dateTime={board.updatedAt}>
                      {formatRelativeTime(board.updatedAt)}
                    </time>
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {board.memberCount == null
                      ? 'Board member count private'
                      : `${board.memberCount} ${board.memberCount === 1 ? 'member' : 'members'}`}
                  </p>
                </div>
                <ArrowRightIcon className="size-4 shrink-0 text-muted group-hover:text-primary" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-line bg-app/40 px-4 py-6 text-center">
          <span className="mb-3 grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
            <ColumnsIcon className="size-6" />
          </span>
          <h3 className="text-sm font-medium text-ink">
            {state === 'ready'
              ? 'No accessible boards yet'
              : 'Recent boards unavailable'}
          </h3>
          <p className="mt-2 max-w-xs text-xs leading-relaxed text-muted">
            {state === 'ready'
              ? 'Boards you have access to will appear here.'
              : 'Your accessible boards will appear here when Workspace services are available.'}
          </p>
          {state === 'ready' && overview?.workspace.canCreateBoards && (
            <Link
              to={`${workspacePath(workspaceId)}/boards?create=board`}
              className="mt-3 inline-flex min-h-11 items-center rounded text-sm text-primary focus-visible:outline-2 focus-visible:outline-primary"
            >
              Create Board
            </Link>
          )}
        </div>
      )}
      <p className="mt-4 flex items-start gap-1.5 text-xs leading-relaxed text-muted">
        <LockIcon className="mt-0.5 size-3.5 shrink-0" />
        Only boards you have access to are shown.
      </p>
    </section>
  );
}
