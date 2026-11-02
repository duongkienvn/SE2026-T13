import { Link, useParams } from 'react-router';
import {
  ArrowRightIcon,
  ColumnsIcon,
  LockIcon,
  UsersIcon,
} from '../../../components/icons';
import { formatRelativeTime } from '../../../lib/format';
import { workspacePath } from '../navigation';
import type { WorkspaceOverview, WorkspaceViewState } from '../types';
import { useWorkspaceBoards } from '../boards/hooks';

export function RecentWorkspaceBoards({
  overview,
  state,
}: {
  overview?: WorkspaceOverview;
  state: WorkspaceViewState;
}) {
  const { workspaceId = '' } = useParams();
  const recent = useWorkspaceBoards(
    workspaceId,
    { search: '', status: 'active', sort: 'recent', page: 1, view: 'recent' },
    state,
  );
  const boards = recent.pageData?.items ?? [];
  const recentState = recent.state;
  return (
    <section
      aria-labelledby="recent-workspace-boards"
      className="flex min-w-0 flex-col rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5"
    >
      <header className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2
          id="recent-workspace-boards"
          className="flex items-center gap-2 text-base font-semibold text-ink"
        >
          <ColumnsIcon className="size-4 text-primary" />
          Recent Boards
        </h2>
        <Link
          to={`${workspacePath(workspaceId)}/boards?view=recent&sort=recent`}
          className="flex min-h-11 items-center gap-1.5 rounded text-xs font-semibold text-primary focus-visible:outline-2 focus-visible:outline-primary"
        >
          View all <ArrowRightIcon className="size-3.5" />
        </Link>
      </header>
      {recentState === 'loading' ? (
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
              <div className="size-11 shrink-0 rounded-lg bg-line" />
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
                className="group -mx-2 flex min-h-18 items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-app focus-visible:bg-app focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span
                  aria-hidden="true"
                  className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"
                >
                  <ColumnsIcon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold break-words text-ink group-hover:text-primary-hover [overflow-wrap:anywhere]">
                    {board.name}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-5 text-muted">
                    {board.isArchived && (
                      <span className="rounded bg-app px-1.5 font-medium">
                        Archived · Read only
                      </span>
                    )}
                    {board.visibility && (
                      <>
                        <span className="inline-flex items-center gap-1">
                          {board.visibility === 'PRIVATE' ? (
                            <LockIcon className="size-3" />
                          ) : (
                            <UsersIcon className="size-3" />
                          )}
                          {board.visibility === 'PRIVATE'
                            ? 'Private'
                            : 'Workspace visible'}
                        </span>
                        <span aria-hidden="true">·</span>
                      </>
                    )}
                    <span>
                      Viewed{' '}
                      {board.lastViewedAt ? (
                        <time
                          dateTime={board.lastViewedAt}
                          title={new Date(board.lastViewedAt).toLocaleString()}
                        >
                          {formatRelativeTime(board.lastViewedAt)}
                        </time>
                      ) : (
                        'Unavailable'
                      )}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {board.memberCount == null
                        ? 'Board member count private'
                        : `${board.memberCount} ${board.memberCount === 1 ? 'member' : 'members'}`}
                    </span>
                  </div>
                </div>
                <ArrowRightIcon className="size-4 shrink-0 text-muted group-hover:text-primary" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-line bg-app/40 px-4 py-6 text-center">
          <span className="mb-3 grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
            <ColumnsIcon className="size-5" />
          </span>
          <h3 className="text-sm font-medium text-ink">
            {recentState === 'ready'
              ? 'No recently viewed boards'
              : 'Recent boards unavailable'}
          </h3>
          <p className="mt-2 max-w-xs text-xs leading-relaxed text-muted">
            {recentState === 'ready'
              ? 'Boards you open will appear here.'
              : 'Your accessible boards will appear here when Workspace services are available.'}
          </p>
          {recentState === 'ready' && overview?.workspace.canCreateBoards && (
            <Link
              to={`${workspacePath(workspaceId)}/boards?create=board`}
              className="mt-3 inline-flex min-h-11 items-center rounded text-sm text-primary focus-visible:outline-2 focus-visible:outline-primary"
            >
              Create Board
            </Link>
          )}
        </div>
      )}
      <p className="mt-auto flex items-start gap-1.5 border-t border-line pt-3 text-xs leading-relaxed text-muted">
        <LockIcon className="mt-0.5 size-3.5 shrink-0" />
        Only boards you have access to are shown.
      </p>
    </section>
  );
}
