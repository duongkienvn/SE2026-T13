import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CardDueStatus } from '@kanban/shared';
import {
  accountDay,
  accountHour,
  dueFilterSignature,
  isStale,
  nextDueInstantDelay,
} from '../../src/features/preferences/temporal.ts';

const at = (iso: string) => Date.parse(iso);

test('account day and hour follow the saved zone across midnight and DST', () => {
  assert.equal(
    accountDay(at('2026-11-27T16:59:59Z'), 'Asia/Bangkok'),
    '2026-11-27',
  );
  assert.equal(
    accountDay(at('2026-11-27T17:00:00Z'), 'Asia/Bangkok'),
    '2026-11-28',
  );
  assert.equal(
    accountDay(at('2026-11-27T17:00:00Z'), 'America/Los_Angeles'),
    '2026-11-27',
  );
  // 2026-11-01 repeats 01:00 in Los Angeles; the civil day is unchanged.
  assert.equal(
    accountDay(at('2026-11-01T08:30:00Z'), 'America/Los_Angeles'),
    '2026-11-01',
  );
  assert.equal(
    accountDay(at('2026-11-01T09:30:00Z'), 'America/Los_Angeles'),
    '2026-11-01',
  );
  assert.equal(accountHour(at('2026-11-27T17:30:00Z'), 'Asia/Bangkok'), 0);
  assert.equal(
    accountHour(at('2026-11-27T17:30:00Z'), 'America/Los_Angeles'),
    9,
  );
});

test('account-day staleness: Home/My Tasks reconcile only after the saved midnight', () => {
  const day = (zone: string) => (t: number) => accountDay(t, zone);
  const fetched = at('2026-11-27T16:00:00Z'); // 23:00 Bangkok
  assert.equal(
    isStale(fetched, day('Asia/Bangkok'), at('2026-11-27T16:59:59Z')),
    false,
  );
  assert.equal(
    isStale(fetched, day('Asia/Bangkok'), at('2026-11-27T17:00:00Z')),
    true,
  );
  // Same instants never cross a Los Angeles midnight.
  assert.equal(
    isStale(fetched, day('America/Los_Angeles'), at('2026-11-27T17:00:00Z')),
    false,
  );
  // Nothing fetched, or an unknown zone, never reconciles.
  assert.equal(
    isStale(undefined, day('UTC'), at('2026-11-29T00:00:00Z')),
    false,
  );
  assert.equal(isStale(0, day('UTC'), at('2026-11-29T00:00:00Z')), false);
  assert.equal(
    isStale(fetched, () => null, at('2026-11-29T00:00:00Z')),
    false,
  );
  // A device clock jump backwards is still a different day.
  assert.equal(
    isStale(fetched, day('Asia/Bangkok'), at('2026-11-26T12:00:00Z')),
    true,
  );
});

test('due-filter signatures separate instant (OVERDUE) from account-day semantics', () => {
  const cards = [
    { dueDate: '2026-11-27T10:00:00.000Z' },
    { dueDate: null },
    { dueDate: '2026-11-27T12:00:00.000Z' },
  ];
  const sig = (status: CardDueStatus | undefined) => (t: number) =>
    dueFilterSignature(cards, status, 'Asia/Bangkok', t);
  const fetched = at('2026-11-27T09:00:30Z');
  // No filter and NO_DUE_DATE never need a request.
  assert.equal(
    isStale(fetched, sig(undefined), at('2026-12-30T00:00:00Z')),
    false,
  );
  assert.equal(
    isStale(
      fetched,
      sig(CardDueStatus.NO_DUE_DATE),
      at('2026-12-30T00:00:00Z'),
    ),
    false,
  );
  // DUE_TODAY: unchanged until a loaded instant passes, then once per change.
  const today = sig(CardDueStatus.DUE_TODAY);
  assert.equal(isStale(fetched, today, at('2026-11-27T09:59:59Z')), false);
  assert.equal(isStale(fetched, today, at('2026-11-27T10:00:00.001Z')), true);
  assert.equal(
    isStale(at('2026-11-27T10:00:01Z'), today, at('2026-11-27T11:59:00Z')),
    false,
  );
  // ...or when the account midnight arrives (17:00Z in Bangkok).
  const late = at('2026-11-27T12:30:00Z');
  assert.equal(isStale(late, today, at('2026-11-27T16:59:00Z')), false);
  assert.equal(isStale(late, today, at('2026-11-27T17:00:00Z')), true);
  assert.equal(
    isStale(late, sig(CardDueStatus.UPCOMING), at('2026-11-27T17:00:00Z')),
    true,
  );
  // OVERDUE: unloaded Cards may cross at any instant, so at most once a minute.
  const overdue = sig(CardDueStatus.OVERDUE);
  assert.equal(isStale(fetched, overdue, at('2026-11-27T09:00:59Z')), false);
  assert.equal(isStale(fetched, overdue, at('2026-11-27T09:01:00Z')), true);
});

test('next due instant wakes just after the earliest future loaded deadline', () => {
  const now = at('2026-11-27T10:00:00Z');
  assert.equal(
    nextDueInstantDelay(
      [
        { dueDate: '2026-11-27T09:00:00Z' },
        { dueDate: '2026-11-27T10:00:05Z' },
        { dueDate: '2026-11-27T10:00:02Z' },
        { dueDate: null },
      ],
      now,
    ),
    2001,
  );
  assert.equal(
    nextDueInstantDelay([{ dueDate: '2026-11-27T09:00:00Z' }], now),
    undefined,
  );
  assert.equal(nextDueInstantDelay([], now), undefined);
});
