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

/**
 * Board tile from boards.png. The whole card opens the board. Its height is
 * fixed so the boards page can count how many rows fit on screen.
 */
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
    <article className="relative flex h-34 w-full flex-col rounded-xl border border-line bg-surface p-4 shadow-card transition-shadow focus-within:ring-3 focus-within:ring-primary/20 hover:shadow-frame">
      {/* Compact row layout (icon beside the title) so more boards fit per page. */}
      <div className="flex items-start gap-3">
        <BoardIcon boardId={board.id} className="size-10 rounded-lg text-xl" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] leading-5 font-semibold text-ink">
            <Link
              to={`/boards/${board.id}`}
              className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
            >
              {board.name}
            </Link>
          </h2>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <RoleChip role={board.currentUserRole} />
            <p className="flex min-w-0 items-center gap-1 text-[13px] text-muted">
              <ClockIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">
                Updated{' '}
                <time dateTime={board.updatedAt}>
                  {formatRelativeTime(board.updatedAt)}
                </time>
              </span>
            </p>
          </div>
        </div>
        {actions.length > 0 && (
          // Above the card-wide link overlay so the menu stays clickable.
          <ActionMenu
            label={`Actions for ${board.name}`}
            items={actions}
            className="z-10 -mt-1 -mr-2"
          />
        )}
      </div>
      <p className="mt-2.5 line-clamp-2 text-sm leading-5 text-muted">
        {board.description || 'No description'}
      </p>
    </article>
  );
}

/** Dashed "Create a new board" tile shown after the last board (boards.png). */
export function CreateBoardTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-34 w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line bg-surface/50 p-4 text-left transition-colors hover:border-primary/40 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-app text-xl text-muted">
        <PlusIcon />
      </span>
      <span>
        <span className="block text-[15px] font-semibold text-ink">
          Create a new board
        </span>
        <span className="mt-0.5 block max-w-[240px] text-[13px] text-muted">
          Start a new Kanban board for your project or team.
        </span>
      </span>
    </button>
  );
}
