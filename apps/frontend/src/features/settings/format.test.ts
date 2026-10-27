import { describe, expect, it } from 'vitest';
import {
  formatCalendarDate,
  formatInstantDate,
  formatTimeIn,
  listTimeZones,
} from './format';

describe('formatCalendarDate', () => {
  it.each([
    ['DD/MM/YYYY', '05/03/2026'],
    ['MM/DD/YYYY', '03/05/2026'],
    ['YYYY-MM-DD', '2026-03-05'],
  ] as const)('rearranges a calendar date as %s', (format, expected) => {
    expect(formatCalendarDate('2026-03-05', format)).toBe(expected);
  });

  it('leaves anything that is not a calendar date unchanged', () => {
    expect(formatCalendarDate('2026-03-05T10:00:00Z', 'DD/MM/YYYY')).toBe(
      '2026-03-05T10:00:00Z',
    );
  });
});

describe('formatInstantDate', () => {
  // 20:00 UTC is already the next day in Ho Chi Minh City (UTC+7).
  const instant = new Date('2026-10-27T20:00:00Z');

  it('uses the calendar date in the chosen time zone', () => {
    expect(formatInstantDate(instant, 'DD/MM/YYYY', 'UTC')).toBe('27/10/2026');
    expect(formatInstantDate(instant, 'DD/MM/YYYY', 'Asia/Ho_Chi_Minh')).toBe(
      '28/10/2026',
    );
    expect(formatInstantDate(instant, 'MM/DD/YYYY', 'America/New_York')).toBe(
      '10/27/2026',
    );
  });

  it('shows 24-hour wall-clock time in the zone', () => {
    expect(formatTimeIn(instant, 'UTC')).toBe('20:00');
    expect(formatTimeIn(instant, 'Asia/Ho_Chi_Minh')).toBe('03:00');
  });
});

describe('listTimeZones', () => {
  it('offers UTC and modern zone names without duplicate aliases', () => {
    const zones = listTimeZones();
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain('Asia/Ho_Chi_Minh');
    expect(zones).not.toContain('Asia/Saigon');
    expect(new Set(zones).size).toBe(zones.length);
    expect(zones.length).toBeGreaterThan(300);
  });

  it('keeps a saved zone that the list would not include, but never an invalid one', () => {
    expect(listTimeZones(['Etc/GMT+5'])).toContain('Etc/GMT+5');
    expect(listTimeZones(['Mars/Base'])).not.toContain('Mars/Base');
  });
});
