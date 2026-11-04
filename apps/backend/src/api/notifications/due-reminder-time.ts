import { createHash } from 'node:crypto';

const minute = 60_000;
const day = 24 * 60 * minute;
const cache = new Map<string, number>();

function localParts(date: Date, timeZone: string): number[] {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  return ['year', 'month', 'day', 'hour', 'minute'].map((name) =>
    Number(parts.find((part) => part.type === name)?.value),
  );
}

export function dueReminderSchedule(
  due: Date,
  timeZone: string,
): {
  localDueDate: string;
  eligibleAt: Date;
} {
  const [year, month, date] = localParts(due, timeZone);
  const localDueDate = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${date.toString().padStart(2, '0')}`;
  const target = Date.UTC(year, month - 1, date - 1, 9);
  const key = `${timeZone}:${target}`;
  let eligible = cache.get(key);
  if (eligible === undefined) {
    // Scan real instants in chronological order: this selects the earlier
    // occurrence of an ambiguous wall time, or the first time after a gap.
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    let closestWallTime = Infinity;
    for (
      let instant = target - 2 * day;
      instant <= target + 2 * day;
      instant += minute
    ) {
      const parts = formatter.formatToParts(new Date(instant));
      const values = ['year', 'month', 'day', 'hour', 'minute'].map((name) =>
        Number(parts.find((part) => part.type === name)?.value),
      );
      const wall = Date.UTC(
        values[0],
        values[1] - 1,
        values[2],
        values[3],
        values[4],
      );
      if (wall >= target && wall < closestWallTime) {
        closestWallTime = wall;
        eligible = instant;
        if (wall === target) break;
      }
    }
    if (eligible === undefined)
      throw new RangeError('Cannot resolve reminder time');
    if (cache.size >= 512) cache.clear();
    cache.set(key, eligible);
  }
  return { localDueDate, eligibleAt: new Date(eligible) };
}

export function dueReminderOccurrence(
  userId: string,
  cardId: string,
  localDueDate: string,
): string {
  return createHash('sha256')
    .update(
      `${userId.toLowerCase()}:${cardId.toLowerCase()}:${localDueDate}:pre-due-v1`,
    )
    .digest('hex');
}
