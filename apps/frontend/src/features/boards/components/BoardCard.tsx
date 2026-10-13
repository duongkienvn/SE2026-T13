import { Link } from 'react-router';
import { ClockIcon } from '../../../components/icons';
import { formatRelativeTime } from '../../../lib/format';
import type { Board } from '../types';
import { BoardIcon } from './BoardIcon';
import { RoleChip } from './RoleChip';

/** Board tile from boards.png. The whole card opens the board. */
export function BoardCard({ board }: { board: Board }) {
  return (
    <article className="relative flex min-h-[300px] w-full flex-col rounded-xl border border-line bg-surface p-6 sm:p-7 shadow-card transition-shadow focus-within:ring-3 focus-within:ring-primary/20 hover:shadow-frame">
      <BoardIcon boardId={board.id} />
      <h2 className="mt-5 text-[21px] leading-snug font-semibold text-ink">
        <Link
          to={`/boards/${board.id}`}
          className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
        >
          {board.name}
        </Link>
      </h2>
      <p className="mt-2 line-clamp-2 text-[17px] leading-relaxed text-muted">
        {board.description || 'No description'}
      </p>
      <div className="mt-auto flex items-center justify-between gap-3 pt-6">
        <p className="flex items-center gap-2 text-[15px] text-muted">
          <ClockIcon aria-hidden="true" className="size-5" />
          <span>
            Updated{' '}
            <time dateTime={board.updatedAt}>
              {formatRelativeTime(board.updatedAt)}
            </time>
          </span>
        </p>
        <RoleChip role={board.currentUserRole} />
      </div>
    </article>
  );
}
