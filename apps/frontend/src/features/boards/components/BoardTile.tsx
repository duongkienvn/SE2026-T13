import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { LockIcon, UsersIcon } from '../../../components/icons';
import { formatRelativeTime } from '../../../lib/format';
import { BoardStar } from './BoardStar';
import { backgroundStyle, useBackgroundPresets } from './BoardBackground';

/** Shared presentation; callers retain their authorized actions and data. */
export function BoardTile({
  board,
  actions,
  navigationLabel,
  stateUpdatedAt,
}: {
  board: {
    id: string;
    name: string;
    updatedAt: string | null;
    isArchived: boolean;
    visibility?: string;
    currentUserRole: string | null;
    backgroundPreset?: string;
    isStarred?: boolean;
    memberCount?: number | null;
  };
  actions?: ReactNode;
  navigationLabel?: string;
  stateUpdatedAt?: number;
}) {
  const presets = useBackgroundPresets();
  return (
    <article className="board-tile group relative flex h-full min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card transition-shadow hover:shadow-frame focus-within:ring-2 focus-within:ring-primary">
      <div
        aria-hidden="true"
        className="h-20 shrink-0 rounded-t-xl border-b border-line bg-primary-soft sm:h-22"
        style={backgroundStyle(
          presets.data?.find((item) => item.id === board.backgroundPreset),
        )}
      />
      <div className="absolute top-2 right-2 z-10">
        <BoardStar
          boardId={board.id}
          boardName={board.name}
          isStarred={board.isStarred}
          stateUpdatedAt={stateUpdatedAt}
        />
      </div>
      <div className="min-w-0 flex-1 px-3.5 pt-3">
        <h2
          title={board.name}
          className="truncate text-sm leading-5 font-semibold text-ink group-hover:text-primary"
        >
          <Link
            to={`/boards/${encodeURIComponent(board.id)}`}
            aria-label={
              navigationLabel ??
              `Open ${board.name}${board.isArchived ? ', archived and read only' : ''}`
            }
            className="after:absolute after:inset-0 focus-visible:outline-none"
          >
            {board.name}
          </Link>
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {board.visibility && (
            <span className="inline-flex items-center gap-1">
              {board.visibility === 'PRIVATE' ? (
                <LockIcon className="size-3" />
              ) : (
                <UsersIcon className="size-3" />
              )}
              {board.visibility === 'PRIVATE' ? 'Private' : 'Workspace visible'}
            </span>
          )}
          {board.currentUserRole && (
            <span className="capitalize">
              {board.currentUserRole === 'OWNER' ? 'Owner' : 'Member'}
            </span>
          )}
          {board.memberCount != null && (
            <span className="inline-flex items-center gap-1">
              <UsersIcon className="size-3" />
              {board.memberCount}{' '}
              {board.memberCount === 1 ? 'member' : 'members'}
            </span>
          )}
          {board.memberCount === null && (
            <span className="sr-only">Board member count private</span>
          )}
        </div>
      </div>
      <footer className="flex min-h-11 items-center justify-between gap-2 px-3.5 pb-2 pt-1 text-xs text-muted">
        <span className="min-w-0 truncate">
          {board.isArchived ? (
            'Archived · Read only'
          ) : board.updatedAt ? (
            <>
              Updated{' '}
              <time dateTime={board.updatedAt}>
                {formatRelativeTime(board.updatedAt)}
              </time>
            </>
          ) : (
            'Update time unavailable'
          )}
        </span>
        <div className="relative z-10 shrink-0">{actions}</div>
      </footer>
    </article>
  );
}
