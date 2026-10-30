import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
  ColumnsIcon,
  LockIcon,
  StarIcon,
  UsersIcon,
} from '../../../components/icons';
import { formatRelativeTime } from '../../../lib/format';
import type { WorkspaceBoardSummary } from './types';

export function WorkspaceBoardCard({
  board,
  actions,
}: {
  board: WorkspaceBoardSummary;
  actions?: ReactNode;
}) {
  return (
    <article className="relative flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card transition-colors hover:border-primary/40">
      <span
        aria-disabled="true"
        className="absolute top-4 left-4 z-10 inline-flex items-center gap-1 rounded-md bg-surface px-2 py-1 text-[11px] text-muted"
      >
        <StarIcon className="size-3" />
        Soon<span className="sr-only">Star board, coming soon</span>
      </span>
      <Link
        to={`/boards/${encodeURIComponent(board.id)}`}
        aria-label={`Open ${board.name}${board.isArchived ? ', archived and read only' : ''}`}
        className="group block min-w-0 flex-1 rounded-t-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <div className="relative m-2 mb-0 flex h-24 items-center justify-center rounded-lg border border-line bg-app text-muted">
          <ColumnsIcon className="size-8" />
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium">
            {board.visibility === 'PRIVATE' ? (
              <LockIcon className="size-3" />
            ) : (
              <UsersIcon className="size-3" />
            )}
            {board.visibility === 'PRIVATE' ? 'Private' : 'Workspace visible'}
          </span>
          {board.isArchived && (
            <span className="absolute bottom-2 left-2 rounded-md bg-surface px-2 py-1 text-xs font-medium text-muted">
              Archived · Read only
            </span>
          )}
        </div>
        <div className="min-w-0 px-4 pt-3">
          <h3
            title={board.name}
            className="line-clamp-2 min-h-10 text-sm leading-5 font-semibold text-ink group-hover:text-primary [overflow-wrap:anywhere]"
          >
            {board.name}
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            {board.updatedAt ? (
              <>
                Updated{' '}
                <time dateTime={board.updatedAt}>
                  {formatRelativeTime(board.updatedAt)}
                </time>
              </>
            ) : (
              'Update time unavailable'
            )}
          </p>
        </div>
      </Link>
      <footer className="flex min-h-15 min-w-0 items-center justify-between gap-2 px-4 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <UsersIcon className="size-4 shrink-0" />
          <span>
            {board.memberCount == null
              ? 'Board member count private'
              : `${board.memberCount} ${board.memberCount === 1 ? 'member' : 'members'}`}
          </span>
        </span>
        {actions}
      </footer>
    </article>
  );
}
