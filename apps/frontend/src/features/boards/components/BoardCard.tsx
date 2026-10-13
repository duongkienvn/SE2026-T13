import { Link } from 'react-router';
import { ActionMenu } from '../../../components/ActionMenu';
import { ClockIcon, PlusIcon } from '../../../components/icons';
import { formatRelativeTime } from '../../../lib/format';
import type { Board } from '../types';
import { BoardIcon } from './BoardIcon';
import { RoleChip } from './RoleChip';

interface BoardCardProps {
  board: Board;
  /** OWNER-only actions; omitted for members. */
  onEdit?: () => void;
  onArchive?: () => void;
}

/** Board tile from boards.png. The whole card opens the board. */
export function BoardCard({ board, onEdit, onArchive }: BoardCardProps) {
  const actions = [
    onEdit && { label: 'Edit board', onSelect: onEdit },
    onArchive && {
      label: 'Archive board',
      onSelect: onArchive,
      tone: 'danger' as const,
    },
  ].filter((item) => !!item);

  return (
    <article className="relative flex min-h-[300px] w-full flex-col rounded-xl border border-line bg-surface p-6 shadow-card transition-shadow focus-within:ring-3 focus-within:ring-primary/20 hover:shadow-frame sm:p-7">
      <div className="flex items-start justify-between gap-3">
        <BoardIcon boardId={board.id} />
        {actions.length > 0 && (
          // Above the card-wide link overlay so the menu stays clickable.
          <ActionMenu
            label={`Actions for ${board.name}`}
            items={actions}
            className="z-10 -mt-1 -mr-2"
          />
        )}
      </div>
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

/** Dashed "Create a new board" tile shown after the last board (boards.png). */
export function CreateBoardTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[300px] w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-surface/50 p-7 text-center transition-colors hover:border-primary/40 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <span className="grid size-16 place-items-center rounded-full bg-app text-[28px] text-muted">
        <PlusIcon />
      </span>
      <span className="mt-5 text-[19px] font-semibold text-ink">
        Create a new board
      </span>
      <span className="mt-1.5 max-w-[240px] text-[16px] text-muted">
        Start a new Kanban board for your project or team.
      </span>
    </button>
  );
}
