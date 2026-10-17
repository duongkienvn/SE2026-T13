import type { ReactNode } from 'react';
import { ClockIcon } from '../../../components/icons';
import { formatDate } from '../../../lib/format';
import { UserAvatar } from '../../auth/components/UserAvatar';
import type { MemberUser } from '../../board-members/types';
import type { Card } from '../types';

/** Avatars shown before the rest collapse into "+N". */
const MAX_AVATARS = 3;

interface KanbanCardProps {
  card: Card;
  /** Board members by user id, to show assignees' names and avatars. */
  members: ReadonlyMap<string, MemberUser>;
  /** Opens the card detail. */
  onOpen?: (card: Card) => void;
  /** Keyboard drag grip, shown at the top left. */
  dragHandle?: ReactNode;
  now?: number;
}

export function KanbanCard({
  card,
  members,
  onOpen,
  dragHandle,
  now = Date.now(),
}: KanbanCardProps) {
  const assignees = card.assignees
    .map((assignee) => members.get(assignee.userId))
    .filter((user): user is MemberUser => !!user);
  const shown = assignees.slice(0, MAX_AVATARS);
  const hidden = assignees.length - shown.length;
  const overdue = !!card.dueDate && new Date(card.dueDate).getTime() < now;

  return (
    <article
      className={`group relative rounded-lg border border-line bg-surface p-4 shadow-card ${
        onOpen ? 'transition-colors hover:border-primary/40' : ''
      }`}
    >
      {(dragHandle || card.dueDate) && (
        <div className="mb-2 flex min-h-5 items-center gap-2">
          {dragHandle}
          {card.dueDate && (
            <p
              className={`ml-auto flex items-center gap-1 text-xs ${
                overdue ? 'font-medium text-danger' : 'text-muted'
              }`}
            >
              <ClockIcon aria-hidden="true" className="size-3.5" />
              <span className="sr-only">Due </span>
              <time dateTime={card.dueDate}>{formatDate(card.dueDate)}</time>
              {overdue && <span>· Overdue</span>}
            </p>
          )}
        </div>
      )}
      <h3 className="text-[15px] font-semibold break-words text-ink">
        {onOpen ? (
          // The ::after overlay makes the whole card the click target.
          <button
            type="button"
            onClick={() => onOpen(card)}
            className="text-left after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-primary"
          >
            {card.title}
          </button>
        ) : (
          card.title
        )}
      </h3>
      {card.description && (
        <p className="mt-1.5 line-clamp-2 text-sm break-words text-muted">
          {card.description}
        </p>
      )}
      {assignees.length > 0 && (
        <div className="mt-3 flex justify-end">
          <ul
            aria-label={`Assigned to ${assignees.map((u) => u.displayName).join(', ')}`}
            className="flex -space-x-1"
          >
            {shown.map((user) => (
              <li key={user.id} title={user.displayName}>
                <UserAvatar
                  user={user}
                  className="size-7 text-[11px] ring-2 ring-surface"
                />
              </li>
            ))}
            {hidden > 0 && (
              <li
                aria-hidden="true"
                className="grid size-7 place-items-center rounded-full bg-app text-[11px] font-semibold text-muted ring-2 ring-surface"
              >
                +{hidden}
              </li>
            )}
          </ul>
        </div>
      )}
    </article>
  );
}
