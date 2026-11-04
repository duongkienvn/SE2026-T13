import type { NotificationResponse } from '@kanban/shared';
import { Link } from 'react-router';
import { formatRelativeTime } from '../../lib/format';
import { formatInstantDate, formatTimeIn } from '../settings/format';
import type { DateFormat } from '../settings/types';
import { kindMeta, unavailableMeta } from './kinds';

export interface RowFormat {
  timeZone: string;
  dateFormat: DateFormat;
}

function exactTime(iso: string, format: RowFormat | undefined) {
  if (!format) return undefined;
  const date = new Date(iso);
  return `${formatInstantDate(date, format.dateFormat, format.timeZone)} ${formatTimeIn(date, format.timeZone)}`;
}

/**
 * One notification. Text is the server's plain-text summary rendered as a
 * React text node; only an available item with an internal target is a link.
 */
export function NotificationRow({
  item,
  format,
  onOpen,
  onMarkRead,
  markPending = false,
  compact = false,
}: {
  item: NotificationResponse;
  format?: RowFormat;
  /** Called when an available, linked item is opened. */
  onOpen?: (item: NotificationResponse) => void;
  onMarkRead?: (item: NotificationResponse) => void;
  markPending?: boolean;
  compact?: boolean;
}) {
  const unread = item.readAt === null;
  const meta = item.isUnavailable ? unavailableMeta : kindMeta[item.kind];
  const link = !item.isUnavailable && item.target ? item.target.path : null;
  const when = (
    <time dateTime={item.createdAt} title={exactTime(item.createdAt, format)}>
      {formatRelativeTime(item.createdAt)}
    </time>
  );
  const body = (
    <>
      <span
        className="notification-icon"
        data-tone={item.isUnavailable ? 'muted' : meta.tone}
        aria-hidden="true"
      >
        <meta.Icon />
      </span>
      <span className="notification-text">
        <span className="notification-title">
          {unread && <span className="sr-only">Unread: </span>}
          {meta.label}
        </span>
        <span className="notification-summary">{item.summary}</span>
        <span className="notification-meta">
          {item.actor && (
            <>
              <span className="notification-actor">
                {item.actor.displayName}
              </span>
              <span aria-hidden="true"> · </span>
            </>
          )}
          {when}
          {item.isUnavailable && (
            <span className="sr-only">
              . You no longer have access to this item.
            </span>
          )}
          {!item.isUnavailable && !link && (
            <span className="sr-only">. No page to open.</span>
          )}
        </span>
      </span>
    </>
  );
  return (
    <div
      className="notification-row"
      data-unread={unread || undefined}
      data-unavailable={item.isUnavailable || undefined}
      data-compact={compact || undefined}
    >
      {link ? (
        <Link
          to={link}
          className="notification-main"
          onClick={() => onOpen?.(item)}
        >
          {body}
        </Link>
      ) : (
        <div className="notification-main">{body}</div>
      )}
      <span className="notification-side">
        {unread && <span className="notification-dot" aria-hidden="true" />}
        {unread && onMarkRead && (!link || !compact) && (
          <button
            type="button"
            className="notification-mark"
            disabled={markPending}
            onClick={() => onMarkRead(item)}
            aria-label={`Mark as read: ${meta.label}`}
          >
            {markPending ? 'Saving…' : 'Mark read'}
          </button>
        )}
      </span>
    </div>
  );
}
