import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  CardDueStatus,
  cardDateInZone,
  deriveCardDueStatus,
  isCardDateInstant,
  parseCardDateInstant,
} from '@kanban/shared';
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

test('due status has explicit reference-clock boundaries and never infers completion', () => {
  const now = '2026-10-31T12:00:00Z';
  assert.equal(deriveCardDueStatus(null, now), CardDueStatus.NO_DUE_DATE);
  assert.equal(
    deriveCardDueStatus('2026-10-31T11:59:59.999Z', now),
    CardDueStatus.OVERDUE,
  );
  assert.equal(deriveCardDueStatus(now, now), CardDueStatus.DUE_TODAY);
  assert.equal(
    deriveCardDueStatus('2026-11-01T00:00:00Z', now),
    CardDueStatus.UPCOMING,
  );
  assert.equal(
    deriveCardDueStatus('2026-11-01T01:00:00Z', now, 'America/New_York'),
    CardDueStatus.DUE_TODAY,
  );
  assert.equal(
    deriveCardDueStatus('2026-10-31T18:00:00Z', now, 'Asia/Ho_Chi_Minh'),
    CardDueStatus.UPCOMING,
  );
  assert.equal(
    cardDateInZone('2026-01-01T00:30:00Z', 'America/Los_Angeles'),
    '2025-12-31',
  );
});

test('IANA calendar days handle spring gaps, fall folds and 23/25-hour days without arithmetic offsets', () => {
  // Spring day is only 23 elapsed hours: still today late in the local day.
  assert.equal(
    deriveCardDueStatus(
      '2026-03-09T03:59:59.999Z',
      '2026-03-08T05:00:00Z',
      'America/New_York',
    ),
    CardDueStatus.DUE_TODAY,
  );
  assert.equal(
    deriveCardDueStatus(
      '2026-03-09T04:00:00Z',
      '2026-03-08T05:00:00Z',
      'America/New_York',
    ),
    CardDueStatus.UPCOMING,
  );
  // Fall day lasts 25 hours, and the repeated 01:30 timestamps are distinct instants.
  assert.equal(
    deriveCardDueStatus(
      '2026-11-02T04:59:59.999Z',
      '2026-11-01T04:00:00Z',
      'America/New_York',
    ),
    CardDueStatus.DUE_TODAY,
  );
  assert.equal(
    deriveCardDueStatus(
      '2026-11-01T01:30:00-05:00',
      '2026-11-01T01:30:00-04:00',
      'America/New_York',
    ),
    CardDueStatus.DUE_TODAY,
  );
  assert.equal(
    deriveCardDueStatus(
      '2026-11-01T01:30:00-04:00',
      '2026-11-01T01:30:00-05:00',
      'America/New_York',
    ),
    CardDueStatus.OVERDUE,
  );
  assert.equal(
    cardDateInZone('2026-03-08T03:30:00-04:00', 'America/New_York'),
    '2026-03-08',
  );
  assert.equal(
    require('@kanban/shared').deriveCardDueStatus(
      null,
      '2026-01-01T00:00Z',
      'UTC',
    ),
    'NO_DUE_DATE',
  );
});

test('projection validates reference instants and named zones even without a deadline', () => {
  for (const zone of ['Invalid/Zone', '+07:00', '-0500', 'UTC+07', ''])
    assert.throws(
      () => deriveCardDueStatus(null, '2026-01-01T00:00Z', zone),
      RangeError,
    );
  assert.throws(
    () => deriveCardDueStatus(null, '2026-01-01', 'UTC'),
    RangeError,
  );
  assert.throws(
    () => deriveCardDueStatus('bad', '2026-01-01T00:00Z', 'UTC'),
    RangeError,
  );
});
