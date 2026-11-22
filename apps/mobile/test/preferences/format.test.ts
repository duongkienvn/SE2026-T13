import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listTimeZones,
  deviceTimeZone,
  regionalPreview,
} from '../../src/features/preferences/format.ts';
import { saved } from './fixtures.ts';
test('zones fallback without supportedValuesOf keeps exact saved aliases and valid query', () => {
  const original = Intl.supportedValuesOf;
  Object.defineProperty(Intl, 'supportedValuesOf', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  try {
    assert.deepEqual(
      listTimeZones(['Asia/Ho_Chi_Minh', 'America/New_York', '+07:00']),
      ['UTC', 'Asia/Ho_Chi_Minh', 'America/New_York'],
    );
  } finally {
    Intl.supportedValuesOf = original;
  }
  assert.ok(deviceTimeZone() === null || typeof deviceTimeZone() === 'string');
});
test('regional examples use one supplied instant including DST and year crossover', () => {
  const p = {
    ...saved,
    timeZone: 'America/New_York',
    dateFormat: 'DD/MM/YYYY' as const,
  };
  assert.match(
    regionalPreview(p, Date.parse('2026-03-08T06:30:00Z')).time,
    /01:30/,
  );
  assert.match(
    regionalPreview(p, Date.parse('2026-03-08T07:30:00Z')).time,
    /03:30/,
  );
  assert.equal(
    regionalPreview(
      { ...p, weekStartsOn: 'sunday' },
      Date.parse('2027-01-01T12:00:00Z'),
    ).weekStart,
    '2026-12-27',
  );
  assert.equal(
    regionalPreview(
      { ...p, timeZone: 'Asia/Ho_Chi_Minh' },
      Date.parse('2024-02-28T18:00:00Z'),
    ).date,
    '29/02/2024',
  );
});
