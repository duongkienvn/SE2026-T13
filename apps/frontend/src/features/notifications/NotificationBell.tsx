import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { NotificationResponse } from '@kanban/shared';
import { ArrowRightIcon, BellIcon } from '../../components/icons';
import { usePreferences } from '../settings/hooks';
import {
  useMarkAllRead,
  useMarkRead,
  useNotificationList,
  useUnreadCount,
} from './hooks';
import { NotificationRow } from './NotificationRow';
import './notifications.css';

export const POPOVER_LIMIT = 5;

export function badgeText(count: number) {
  return count > 99 ? '99+' : String(count);
}

/** Header bell: authoritative unread badge and a popover of recent unread items. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const count = useUnreadCount();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const value = count.count;
  const label =
    value === undefined
      ? count.isError
        ? 'Notifications, unread count unavailable'
        : 'Notifications, loading unread count'
      : value === 0
        ? 'Notifications, no unread'
        : `Notifications, ${value} unread`;

  const close = (restore = true) => {
    setOpen(false);
    if (restore) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target))
        setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
    };
    // Tabbing out of the popover closes it without stealing focus back.
    const onFocus = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target))
        setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
    };
  }, [open]);

  return (
    <div className="notification-bell">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((current) => !current)}
        className="notification-bell-button"
      >
        <BellIcon className="size-[22px]" />
        {!!value && (
          <span className="notification-badge" aria-hidden="true">
            {badgeText(value)}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-labelledby={`${id}-title`}
          tabIndex={-1}
          className="notification-popover"
        >
          <PopoverContent
            titleId={`${id}-title`}
            unread={value}
            onNavigate={() => close(false)}
          />
        </div>
      )}
    </div>
  );
}

function PopoverContent({
  titleId,
  unread,
  onNavigate,
}: {
  titleId: string;
  unread: number | undefined;
  onNavigate: () => void;
}) {
  const list = useNotificationList('unread', 1, POPOVER_LIMIT);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const preferences = usePreferences();
  const format = preferences.data && {
    timeZone: preferences.data.timeZone,
    dateFormat: preferences.data.dateFormat,
  };
  const open = (item: NotificationResponse) => {
    if (item.readAt === null) markRead.mutate(item.id);
    onNavigate();
  };
  const items = list.page?.items;

  return (
    <>
      <div className="notification-popover-head">
        <h2 id={titleId}>Notifications</h2>
        {!!unread && (
          <button
            type="button"
            className="notification-link"
            disabled={markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            {markAll.isPending ? 'Marking…' : 'Mark all as read'}
          </button>
        )}
      </div>
      {markAll.isError && (
        <p role="alert" className="notification-error">
          Could not mark all as read.{' '}
          <button
            type="button"
            className="notification-link"
            onClick={() => markAll.mutate()}
          >
            Retry
          </button>
        </p>
      )}
      {markRead.isError && (
        <p role="alert" className="notification-error">
          Could not mark that notification as read.
        </p>
      )}
      <div className="notification-popover-body">
        {list.isError ? (
          <p role="alert" className="notification-empty">
            Notifications are unavailable.{' '}
            <button
              type="button"
              className="notification-link"
              onClick={() => void list.refetch()}
            >
              Retry
            </button>
          </p>
        ) : !items ? (
          <p role="status" className="notification-empty">
            Loading notifications…
          </p>
        ) : items.length === 0 ? (
          <p className="notification-empty">You&apos;re all caught up.</p>
        ) : (
          <ul aria-label="Unread notifications">
            {items.map((item) => (
              <li key={item.id}>
                <NotificationRow
                  item={item}
                  format={format || undefined}
                  onOpen={open}
                  onMarkRead={(row) => markRead.mutate(row.id)}
                  markPending={
                    markRead.isPending && markRead.variables === item.id
                  }
                  compact
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <Link
        to="/notifications"
        className="notification-view-all"
        onClick={onNavigate}
      >
        View all notifications <ArrowRightIcon aria-hidden="true" />
      </Link>
    </>
  );
}
