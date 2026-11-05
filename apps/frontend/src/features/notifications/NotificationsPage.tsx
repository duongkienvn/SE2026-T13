import type { NotificationResponse } from '@kanban/shared';
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PageContainer } from '../../components/PageContainer';
import { Button, buttonClassName } from '../../components/Button';
import { Pagination } from '../../components/Pagination';
import {
  BellIcon,
  CheckCircleIcon,
  SettingsIcon,
} from '../../components/icons';
import { usePageTitle } from '../../hooks/usePageTitle';
import { isApiError } from '../../lib/api-client';
import { formatInstantDate } from '../settings/format';
import { usePreferences } from '../settings/hooks';
import {
  useMarkAllRead,
  useMarkRead,
  useNotificationList,
  useUnreadCount,
} from './hooks';
import { NotificationRow, type RowFormat } from './NotificationRow';
import './notifications.css';

/** Rows per server page; keeps the inbox on one screen on laptops. */
export const INBOX_PAGE_SIZE = 5;

export function parseInboxSearch(params: URLSearchParams) {
  const filter = params.get('filter') === 'unread' ? 'unread' : 'all';
  const raw = params.get('page');
  const page = raw && /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : 1;
  return { filter, page } as const;
}

/** Server order is kept; rows are only labelled by their local calendar day. */
export function groupByDay(
  items: NotificationResponse[],
  format: RowFormat,
  now = new Date(),
) {
  const key = (date: Date) =>
    formatInstantDate(date, 'YYYY-MM-DD', format.timeZone);
  const today = key(now);
  const yesterday = key(new Date(now.getTime() - 86_400_000));
  const groups: { label: string; items: NotificationResponse[] }[] = [];
  for (const item of items) {
    const day = key(new Date(item.createdAt));
    const label =
      day === today
        ? 'Today'
        : day === yesterday
          ? 'Yesterday'
          : formatInstantDate(
              new Date(item.createdAt),
              format.dateFormat,
              format.timeZone,
            );
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function NotificationsPage() {
  usePageTitle('Notifications');
  const [params, setParams] = useSearchParams();
  const { filter, page } = parseInboxSearch(params);
  const list = useNotificationList(filter, page, INBOX_PAGE_SIZE);
  const count = useUnreadCount();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const preferences = usePreferences();
  const format: RowFormat = {
    timeZone: preferences.data?.timeZone ?? 'UTC',
    dateFormat: preferences.data?.dateFormat ?? 'YYYY-MM-DD',
  };
  const data = list.page;

  const go = (next: { page: number }, replace = false) => {
    const search = new URLSearchParams();
    if (filter === 'unread') search.set('filter', 'unread');
    if (next.page > 1) search.set('page', String(next.page));
    setParams(search, { replace });
  };

  // An emptied last page (e.g. after Mark read on Unread) moves back.
  useEffect(() => {
    if (!data || list.isFetching) return;
    const last = Math.max(1, data.meta.totalPages);
    if (page > last) go({ page: last }, true);
  }, [data, list.isFetching, page]);

  const error = isApiError(list.error) ? list.error : undefined;
  const unread = count.count;

  return (
    <PageContainer>
      <div className="notifications-page">
        <header className="notifications-header">
          <span className="notifications-header-icon" aria-hidden="true">
            <BellIcon />
          </span>
          <div className="notifications-heading">
            <h1>Notifications</h1>
            <p>Stay updated on what matters.</p>
          </div>
          <div className="notifications-actions">
            <Link
              to="/settings/notifications"
              className={buttonClassName('secondary', 'sm')}
            >
              <SettingsIcon aria-hidden="true" />
              Preferences
            </Link>
            <Button
              variant="secondary"
              size="sm"
              className="notifications-mark-all"
              disabled={!unread || markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              <CheckCircleIcon aria-hidden="true" />
              {markAll.isPending ? 'Marking…' : 'Mark all as read'}
            </Button>
          </div>
        </header>
        <div className="notifications-toolbar">
          <nav aria-label="Notification filter" className="notifications-tabs">
            {(['all', 'unread'] as const).map((value) => (
              <Link
                key={value}
                // A filter change always starts again at page 1.
                to={
                  value === 'unread'
                    ? '/notifications?filter=unread'
                    : '/notifications'
                }
                aria-current={filter === value ? 'page' : undefined}
                className="notifications-tab"
              >
                {value === 'all' ? 'All' : 'Unread'}
                {value === 'unread' && unread !== undefined && ` (${unread})`}
              </Link>
            ))}
          </nav>
        </div>
        {markAll.isSuccess && (
          <p role="status" className="notifications-status">
            {markAll.data === 0
              ? 'Everything was already read.'
              : `Marked ${markAll.data} ${markAll.data === 1 ? 'notification' : 'notifications'} as read.`}
          </p>
        )}
        {(markAll.isError || markRead.isError) && (
          <p role="alert" className="notifications-status text-danger">
            Could not update read state. Try again.
          </p>
        )}
        <div className="notifications-list">
          {list.isError ? (
            <div role="alert" className="notification-empty">
              {error?.status === 0
                ? 'You appear to be offline. Reconnect and try again.'
                : 'Notifications are unavailable.'}{' '}
              <button
                type="button"
                className="notification-link"
                onClick={() => void list.refetch()}
              >
                Retry
              </button>
            </div>
          ) : !data ? (
            <p role="status" className="notification-empty">
              Loading notifications…
            </p>
          ) : data.items.length === 0 ? (
            <div className="notifications-empty">
              <span className="notifications-header-icon" aria-hidden="true">
                <BellIcon />
              </span>
              <h2>
                {filter === 'unread'
                  ? 'No unread notifications'
                  : 'No notifications yet'}
              </h2>
              <p>
                {filter === 'unread'
                  ? 'You are all caught up.'
                  : 'Assignments, mentions, invitations and reminders will show up here.'}
              </p>
            </div>
          ) : (
            groupByDay(data.items, format).map((group) => (
              <section
                key={group.label}
                aria-label={group.label}
                className="notifications-day"
              >
                <h2>{group.label}</h2>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <NotificationRow
                        item={item}
                        format={format}
                        onOpen={(row) => {
                          if (row.readAt === null) markRead.mutate(row.id);
                        }}
                        onMarkRead={(row) => markRead.mutate(row.id)}
                        markPending={
                          markRead.isPending && markRead.variables === item.id
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
        {data && (
          <Pagination
            label="Notification pages"
            page={data.meta.page}
            pageCount={data.meta.totalPages}
            onChange={(next) => go({ page: next })}
            className="mt-2"
          />
        )}
      </div>
    </PageContainer>
  );
}
