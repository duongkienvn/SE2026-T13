import {
  isQuietAt,
  nextAllowedInstant,
} from '../../src/api/push/push-schedule-time';
const at = (value: string) => new Date(value);
describe('pure IANA quiet hours', () => {
  it.each([
    ['2026-01-01T21:59:59.999Z', false],
    ['2026-01-01T22:00:00Z', true],
    ['2026-01-02T00:00:00Z', true],
    ['2026-01-02T06:59:59.999Z', true],
    ['2026-01-02T07:00:00Z', false],
  ])('overnight boundary %s', (value, quiet) => {
    expect(isQuietAt(at(value), 'UTC', '22:00', '07:00')).toBe(quiet);
  });
  it.each([
    ['08:59:59', false],
    ['09:00:00', true],
    ['16:59:59', true],
    ['17:00:00', false],
  ])('same-day boundary %s', (time, quiet) => {
    expect(isQuietAt(at(`2026-01-01T${time}Z`), 'UTC', '09:00', '17:00')).toBe(
      quiet,
    );
  });
  it.each([
    ['Pacific/Kiritimati', '2026-01-01T08:00:00Z', '2026-01-01T17:00:00.000Z'],
    ['Pacific/Honolulu', '2026-01-02T08:00:00Z', '2026-01-02T17:00:00.000Z'],
    ['Asia/Kathmandu', '2026-01-01T16:15:00Z', '2026-01-02T01:15:00.000Z'],
  ])('projects offset and day rollover in %s', (zone, value, end) => {
    expect(isQuietAt(at(value), zone, '22:00', '07:00')).toBe(true);
    expect(
      nextAllowedInstant(at(value), zone, '22:00', '07:00').toISOString(),
    ).toBe(end);
  });
  it('resolves nonexistent spring end to first non-quiet real minute', () => {
    expect(
      nextAllowedInstant(
        at('2026-03-08T06:45:31Z'),
        'America/New_York',
        '01:30',
        '02:30',
      ).toISOString(),
    ).toBe('2026-03-08T07:00:00.000Z');
    expect(
      nextAllowedInstant(
        at('2026-03-08T06:45:31Z'),
        'America/New_York',
        '01:30',
        '03:30',
      ).toISOString(),
    ).toBe('2026-03-08T07:30:00.000Z');
  });
  it('suppresses both fold occurrences and uses the next actual allowed minute', () => {
    for (const instant of ['2026-11-01T05:45:00Z', '2026-11-01T06:45:00Z']) {
      expect(isQuietAt(at(instant), 'America/New_York', '01:30', '02:00')).toBe(
        true,
      );
      expect(
        nextAllowedInstant(
          at(instant),
          'America/New_York',
          '00:30',
          '02:00',
        ).toISOString(),
      ).toBe('2026-11-01T07:00:00.000Z');
    }
    // At the fold, 01:00 is outside 01:30–02:00. A later 01:30 is guarded anew.
    expect(
      isQuietAt(
        at('2026-11-01T06:00:00Z'),
        'America/New_York',
        '01:30',
        '02:00',
      ),
    ).toBe(false);
  });
  it('handles non-hour DST transitions and almost-full-day intervals', () => {
    expect(
      nextAllowedInstant(
        at('2026-10-03T15:15:00Z'),
        'Australia/Lord_Howe',
        '01:00',
        '02:15',
      ).toISOString(),
    ).toBe('2026-10-03T15:30:00.000Z');
    expect(
      nextAllowedInstant(
        at('2026-01-01T00:15:01Z'),
        'UTC',
        '00:15',
        '00:00',
      ).toISOString(),
    ).toBe('2026-01-02T00:00:00.000Z');
  });
  it('uses the new timezone without rewriting wall clocks; returns an allowed instant unchanged', () => {
    const instant = at('2026-01-01T22:15:42.123Z');
    expect(isQuietAt(instant, 'UTC', '22:00', '07:00')).toBe(true);
    expect(isQuietAt(instant, 'Asia/Tokyo', '22:00', '07:00')).toBe(false);
    expect(nextAllowedInstant(instant, 'Asia/Tokyo', '22:00', '07:00')).toEqual(
      instant,
    );
  });
  it('fails closed on malformed intervals or zones', () => {
    expect(() =>
      isQuietAt(at('2026-01-01Z'), 'invalid', '22:00', '07:00'),
    ).toThrow(RangeError);
    expect(() =>
      nextAllowedInstant(new Date(), 'UTC', '22:00', '22:00'),
    ).toThrow(RangeError);
    expect(() =>
      nextAllowedInstant(new Date(), 'UTC', '9:00', '07:00'),
    ).toThrow(RangeError);
  });
});
