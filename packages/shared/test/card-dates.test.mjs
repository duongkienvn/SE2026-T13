import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { isCardDateInstant, parseCardDateInstant } from '@kanban/shared';
const require = createRequire(import.meta.url);

test('strict Card instants normalize offsets, leap years, optional seconds and legacy fractions', () => {
  for (const [input, expected] of [
    ['2026-10-31T07:30:00+07:00', '2026-10-31T00:30:00.000Z'],
    ['2024-02-29T23:59:59.999Z', '2024-02-29T23:59:59.999Z'],
    ['2026-01-01T00:00-05:00', '2026-01-01T05:00:00.000Z'],
    ['2026-01-01T00:00:00.123456Z', '2026-01-01T00:00:00.123Z'],
    ['0001-01-01T00:00:00Z', '0001-01-01T00:00:00.000Z'],
  ])
    assert.equal(parseCardDateInstant(input).toISOString(), expected);
  assert.equal(
    require('@kanban/shared')
      .parseCardDateInstant('2026-01-01T00:00Z')
      .toISOString(),
    '2026-01-01T00:00:00.000Z',
  );
});

test('invalid civil/local dates, offsets, component overflow and non-finite inputs fail', () => {
  for (const input of [
    null,
    undefined,
    0,
    NaN,
    Infinity,
    new Date(),
    '',
    '2026-01-01',
    '2026-01-01T01:00:00',
    '2026-02-29T00:00:00Z',
    '2024-02-30T00:00:00Z',
    '1900-02-29T00:00:00Z',
    '2026-00-01T00:00Z',
    '2026-13-01T00:00Z',
    '2026-01-00T00:00Z',
    '2026-01-01T24:00Z',
    '2026-01-01T00:60Z',
    '2026-01-01T00:00:60Z',
    '2026-01-01T00:00+24:00',
    '2026-01-01T00:00+01:60',
    '0000-01-01T00:00Z',
    '0001-01-01T00:00+00:01',
    '9999-12-31T23:59-00:01',
    '2026-01-01 00:00Z',
    '2026-01-01T00:00Z trailing',
    '2026-01-01T00:00:00.1234567890Z',
  ]) {
    assert.equal(isCardDateInstant(input), false, String(input));
    assert.throws(() => parseCardDateInstant(input), RangeError);
  }
});
