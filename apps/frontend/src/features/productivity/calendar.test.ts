import { describe, expect, it } from 'vitest';
import { nextCalendarDay, startOfDay } from './calendar';

describe('task date boundaries', () => {
  it('uses calendar days across spring and autumn DST changes', () => {
    expect(startOfDay('2026-03-08', 'America/New_York')).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(startOfDay('2026-03-09', 'America/New_York')).toBe(
      '2026-03-09T04:00:00.000Z',
    );
    expect(startOfDay('2026-11-01', 'America/New_York')).toBe(
      '2026-11-01T04:00:00.000Z',
    );
    expect(startOfDay('2026-11-02', 'America/New_York')).toBe(
      '2026-11-02T05:00:00.000Z',
    );
  });

  it('handles skipped local midnight and a skipped day', () => {
    expect(startOfDay('2018-11-04', 'America/Sao_Paulo')).toBe(
      '2018-11-04T03:00:00.000Z',
    );
    expect(startOfDay('2011-12-30', 'Pacific/Apia')).toBe(
      '2011-12-30T10:00:00.000Z',
    );
    expect(startOfDay('2020-11-01', 'America/Havana')).toBe(
      '2020-11-01T04:00:00.000Z',
    );
    expect(nextCalendarDay('2024-02-29')).toBe('2024-03-01');
  });
});
