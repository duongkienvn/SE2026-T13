import { describe, expect, it } from 'vitest';
import {
  cardDueStatus,
  formatCardInstant,
  offsetLabel,
  resolveWallClock,
  wallClockOf,
} from './card-dates';

describe('card dates in the saved time zone', () => {
  it('turns a wall clock into the instant it names, not the browser zone', () => {
    expect(
      resolveWallClock(
        { date: '2026-11-02', time: '09:00' },
        'Asia/Ho_Chi_Minh',
      ),
    ).toEqual({ kind: 'exact', instant: '2026-11-02T02:00:00.000Z' });
    expect(
      resolveWallClock({ date: '2026-11-02', time: '09:00' }, 'UTC'),
    ).toEqual({ kind: 'exact', instant: '2026-11-02T09:00:00.000Z' });
    expect(
      resolveWallClock(
        { date: '2026-07-01', time: '23:30' },
        'Pacific/Kiritimati',
      ),
    ).toEqual({ kind: 'exact', instant: '2026-07-01T09:30:00.000Z' });
  });

  it('refuses a time skipped by spring forward instead of guessing', () => {
    expect(
      resolveWallClock(
        { date: '2026-03-08', time: '02:30' },
        'America/New_York',
      ),
    ).toEqual({ kind: 'nonexistent' });
  });

  it('offers both instants of a time repeated by fall back, earliest first', () => {
    expect(
      resolveWallClock(
        { date: '2026-11-01', time: '01:30' },
        'America/New_York',
      ),
    ).toEqual({
      kind: 'ambiguous',
      instants: ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z'],
    });
    expect(offsetLabel('2026-11-01T05:30:00.000Z', 'America/New_York')).toBe(
      'UTC−04:00',
    );
    expect(offsetLabel('2026-11-01T06:30:00.000Z', 'America/New_York')).toBe(
      'UTC−05:00',
    );
  });

  it('rejects impossible days and malformed input', () => {
    for (const value of [
      { date: '2026-02-30', time: '10:00' },
      { date: '2026-13-01', time: '10:00' },
      { date: '2026-01-01', time: '24:00' },
      { date: '', time: '10:00' },
      { date: '2026-01-01', time: '' },
    ])
      expect(resolveWallClock(value, 'UTC')).toEqual({ kind: 'invalid' });
    expect(
      resolveWallClock({ date: '2028-02-29', time: '12:00' }, 'UTC'),
    ).toEqual({ kind: 'exact', instant: '2028-02-29T12:00:00.000Z' });
  });

  it('round-trips a stored instant through the editor in any zone', () => {
    const instant = '2026-11-01T06:30:00.000Z';
    for (const zone of [
      'UTC',
      'Asia/Ho_Chi_Minh',
      'Pacific/Pago_Pago',
      'Asia/Kathmandu',
    ]) {
      const clock = wallClockOf(instant, zone);
      const resolved = resolveWallClock(clock, zone);
      expect(resolved).toEqual({ kind: 'exact', instant });
    }
    expect(wallClockOf(instant, 'Asia/Ho_Chi_Minh')).toEqual({
      date: '2026-11-01',
      time: '13:30',
    });
  });

  it('formats in the chosen date format and zone', () => {
    expect(
      formatCardInstant(
        '2026-11-01T18:05:00.000Z',
        'DD/MM/YYYY',
        'Asia/Ho_Chi_Minh',
      ),
    ).toBe('02/11/2026 01:05');
    expect(formatCardInstant('not a date', 'YYYY-MM-DD', 'UTC')).toBe(
      'not a date',
    );
  });

  it('derives due status with the shared rule and an explicit clock', () => {
    const now = Date.parse('2026-11-01T10:00:00.000Z');
    expect(cardDueStatus(null, now, 'UTC')).toBe('NO_DUE_DATE');
    expect(cardDueStatus('2026-11-01T09:59:59.000Z', now, 'UTC')).toBe(
      'OVERDUE',
    );
    expect(cardDueStatus('2026-11-01T23:00:00.000Z', now, 'UTC')).toBe(
      'DUE_TODAY',
    );
    // Same instant, but already tomorrow in Ho Chi Minh City.
    expect(
      cardDueStatus('2026-11-01T23:00:00.000Z', now, 'Asia/Ho_Chi_Minh'),
    ).toBe('UPCOMING');
    expect(cardDueStatus('garbage', now, 'UTC')).toBeNull();
  });
});
