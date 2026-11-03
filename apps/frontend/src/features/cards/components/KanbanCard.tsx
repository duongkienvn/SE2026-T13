import { useContext, type ReactNode } from 'react';
import {
  CalendarIcon,
  CheckSquareIcon,
  PaperclipIcon,
  CommentIcon,
} from '../../../components/icons';
import { formatCardInstant, formatCardPreviewDate } from '../card-dates';
import { DueStatusBadge } from './detail/CardDates';
import { PreviewContext } from './preview-context';
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
  const {
    summaries,
    labels,
    timeZone,
    dateFormat,
    now: boardNow,
  } = useContext(PreviewContext);
  const summary = summaries.get(card.id);
  const cardLabels = labels.filter((label) =>
    summary?.labelIds.includes(label.id),
  );
  const assignees = card.assignees
    .map((assignee) => members.get(assignee.userId))
    .filter((user): user is MemberUser => !!user);
  const shown = assignees.slice(0, MAX_AVATARS);
  const hidden = assignees.length - shown.length;

  const checklist = summary?.checklist;
  const total = checklist?.totalItems ?? 0;
  const checked = checklist?.checkedItems ?? 0;
  const complete = total > 0 && checked === total;
  const hasFooter =
    total > 0 ||
    !!summary?.attachmentCount ||
    !!summary?.commentCount ||
    assignees.length > 0;
  const clock = boardNow || now;
  const date = (value: string) => (
    <time
      dateTime={value}
      title={`${formatCardInstant(value, dateFormat, timeZone)} (${timeZone})`}
    >
      {formatCardPreviewDate(value, dateFormat, timeZone, clock)}
    </time>
  );
  return (
    <article
      className={`group relative rounded-lg border border-line bg-surface p-3 shadow-card ${onOpen ? 'transition-colors hover:border-primary/40' : ''}`}
    >
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-sm leading-5 font-semibold break-words text-ink">
          {onOpen ? (
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
        {card.dueDate && (
          <span className="shrink-0">
            <DueStatusBadge
              dueDate={card.dueDate}
              timeZone={timeZone}
              now={clock}
            />
          </span>
        )}
        {dragHandle}
      </div>
      {card.description && (
        <p className="mt-1 line-clamp-2 text-xs leading-4 break-words text-muted">
          {card.description}
        </p>
      )}
      {(card.startDate || card.dueDate) && (
        <div
          role="group"
          className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted"
          aria-label={`${card.startDate ? `Starts ${formatCardInstant(card.startDate, dateFormat, timeZone)}. ` : ''}${card.dueDate ? `Due ${formatCardInstant(card.dueDate, dateFormat, timeZone)}. ` : ''}${timeZone}`}
        >
          <CalendarIcon className="size-3.5 shrink-0" />
          {card.startDate && date(card.startDate)}
          {card.startDate && card.dueDate && <span aria-hidden="true">→</span>}
          {card.dueDate && date(card.dueDate)}
        </div>
      )}
      {cardLabels.length > 0 && (
        <ul aria-label="Card labels" className="mt-2 flex flex-wrap gap-1">
          {cardLabels.map((label) => (
            <li
              key={label.id}
              title={label.name}
              className="max-w-full truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-ink"
              style={{
                borderColor: `color-mix(in srgb, ${label.color} 35%, transparent)`,
                backgroundColor: `color-mix(in srgb, ${label.color} 16%, var(--color-surface))`,
              }}
            >
              <span
                aria-hidden="true"
                style={{ backgroundColor: label.color }}
                className="mr-1 inline-block size-1.5 rounded-full"
              />
              {label.name}
            </li>
          ))}
        </ul>
      )}
      {hasFooter && (
        <footer className="mt-2.5 flex items-center gap-2 text-[11px] text-muted">
          {total > 0 && (
            <span
              className={`inline-flex items-center gap-1 ${complete ? 'text-success' : ''}`}
              title={`Checklist ${checked}/${total}`}
            >
              <CheckSquareIcon className="size-3.5" />
              <span className="sr-only">Checklist </span>
              {checked}/{total}
              <span
                role="progressbar"
                aria-label="Checklist progress"
                aria-valuenow={checked}
                aria-valuemin={0}
                aria-valuemax={total}
                className="ml-0.5 h-1 w-6 overflow-hidden rounded-full bg-primary-soft"
              >
                <span
                  className={`block h-full rounded-full ${complete ? 'bg-success' : 'bg-primary'}`}
                  style={{ width: `${Math.round((checked / total) * 100)}%` }}
                />
              </span>
            </span>
          )}
          {!!summary?.attachmentCount && (
            <span
              className="inline-flex items-center gap-1"
              title={`Attachments ${summary.attachmentCount}`}
            >
              <PaperclipIcon className="size-3.5" />
              <span className="sr-only">Attachments </span>
              {summary.attachmentCount}
            </span>
          )}
          {!!summary?.commentCount && (
            <span
              className="inline-flex items-center gap-1"
              title={`Comments ${summary.commentCount}`}
            >
              <CommentIcon className="size-3.5" />
              <span className="sr-only">Comments </span>
              {summary.commentCount}
            </span>
          )}
          {assignees.length > 0 && (
            <ul
              aria-label={`Assigned to ${assignees.map((u) => u.displayName).join(', ')}`}
              className="ml-auto flex shrink-0 -space-x-2"
            >
              {shown.map((user) => (
                <li key={user.id} title={user.displayName}>
                  <UserAvatar
                    user={user}
                    className="size-6 text-[10px] ring-2 ring-surface"
                  />
                </li>
              ))}
              {hidden > 0 && (
                <li
                  aria-hidden="true"
                  className="grid size-6 place-items-center rounded-full bg-app text-[10px] font-semibold text-muted ring-2 ring-surface"
                >
                  +{hidden}
                </li>
              )}
            </ul>
          )}
        </footer>
      )}
    </article>
  );
}
