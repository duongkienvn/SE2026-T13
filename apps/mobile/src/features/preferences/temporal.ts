import { CardDueStatus, cardDateInZone } from '@kanban/shared';
import { wallTime } from '../cards/metadata/dates.ts';

/**
 * Account-day and due-instant helpers. Two clocks are deliberately distinct:
 * - Home/My Tasks groups are server account-day buckets (`dueDate < today`),
 *   so they only move at the saved timezone's midnight.
 * - Board `dueStatus` OVERDUE is instant based (`dueDate < now`); DUE_TODAY
 *   and UPCOMING additionally move at account midnight.
 */
export function accountDay(at: number, timeZone: string) {
  return cardDateInZone(new Date(at).toISOString(), timeZone);
}

export function accountHour(at: number, timeZone: string) {
  return wallTime(at, timeZone).getUTCHours();
}

/** Delay until the next loaded due instant has passed, if any is in the future. */
export function nextDueInstantDelay(
  cards: readonly { dueDate: string | null }[],
  now: number,
) {
  let next = Infinity;
  for (const { dueDate } of cards) {
    const deadline = dueDate ? Date.parse(dueDate) : NaN;
    if (deadline >= now) next = Math.min(next, deadline - now + 1);
  }
  return Number.isFinite(next) ? next : undefined;
}

/**
 * Identity of an active server due-status filter result at instant `at`.
 * `null` means time cannot change the result (no filter or NO_DUE_DATE), so
 * no reconciliation request is ever needed.
 */
export function dueFilterSignature(
  cards: readonly { dueDate: string | null }[],
  status: CardDueStatus | undefined,
  timeZone: string,
  at: number,
): string | null {
  if (!status || status === CardDueStatus.NO_DUE_DATE) return null;
  // Unloaded Cards can become overdue at any instant; match Web's minute cadence.
  if (status === CardDueStatus.OVERDUE) return String(Math.floor(at / 60_000));
  // Loaded Cards leave DUE_TODAY/UPCOMING at their instant; others enter at midnight.
  const passed = cards.filter(
    ({ dueDate }) => dueDate !== null && Date.parse(dueDate) < at,
  ).length;
  return `${accountDay(at, timeZone)}|${passed}`;
}

/** True while data classified at `fetchedAt` may differ from a read at `now`. */
export function isStale(
  fetchedAt: number | undefined,
  signature: (at: number) => string | null,
  now: number,
) {
  if (!fetchedAt) return false;
  const current = signature(now);
  return current !== null && current !== signature(fetchedAt);
}
