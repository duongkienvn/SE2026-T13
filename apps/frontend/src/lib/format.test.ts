import { describe, expect, it } from 'vitest';
import { formatDate, formatRelativeTime } from './format';

const NOW = Date.parse('2026-10-13T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('formatRelativeTime', () => {
  it.each([
    [ago(10 * 1000), 'just now'],
    [ago(5 * 60 * 1000), '5 minutes ago'],
    [ago(2 * 60 * 60 * 1000), '2 hours ago'],
    [ago(24 * 60 * 60 * 1000), 'yesterday'],
    [ago(3 * 24 * 60 * 60 * 1000), '3 days ago'],
    [ago(7 * 24 * 60 * 60 * 1000), 'last week'],
  ])('formats %s as "%s"', (iso, expected) => {
    expect(formatRelativeTime(iso, NOW)).toBe(expected);
  });
});

describe('formatDate', () => {
  it('formats an ISO timestamp as a short date', () => {
    // Local noon, so the calendar date is the same in every time zone.
    expect(formatDate(new Date(2026, 9, 12, 12).toISOString())).toBe(
      'Oct 12, 2026',
    );
  });
});
