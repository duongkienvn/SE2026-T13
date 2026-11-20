import type { NotificationResponse } from '@kanban/shared';
import {
  wallTime,
  formatWallTime,
  describeCardDate,
  type DatePreferences,
} from '../cards/metadata/dates.ts';
export const compactUnread = (count: number) =>
  count >= 100 ? '99+' : String(count);
export const notificationTime = describeCardDate;
export function groupNotifications(
  items: readonly NotificationResponse[],
  preferences: DatePreferences,
  now = new Date(),
) {
  const todayWall = wallTime(now.getTime(), preferences.timeZone);
  const today = formatWallTime(todayWall, 'YYYY-MM-DD').date;
  const previousDay = new Date(todayWall);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const yesterday = formatWallTime(previousDay, 'YYYY-MM-DD').date;
  const groups: {
    key: string;
    label: string;
    items: NotificationResponse[];
  }[] = [];
  for (const item of items) {
    const local = wallTime(item.createdAt, preferences.timeZone);
    const key = formatWallTime(local, 'YYYY-MM-DD').date;
    const label =
      key === today
        ? 'Today'
        : key === yesterday
          ? 'Yesterday'
          : formatWallTime(local, preferences.dateFormat).date;
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, label, items: [item] });
  }
  return groups;
}
