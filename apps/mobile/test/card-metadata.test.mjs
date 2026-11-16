import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  createMetadataApi,
  labelFields,
  labelPatch,
} from '../src/features/cards/metadata/api.ts';
import {
  applyPickerValue,
  dateRangeError,
  describeCardDate,
  dueClockDelay,
  dueStatus,
  formatOffset,
  resolveWallTime,
  wallTime,
} from '../src/features/cards/metadata/dates.ts';
import {
  metadataTargets,
  runMetadataMutation,
} from '../src/features/cards/metadata/mutations.ts';
import { createKanbanApi } from '../src/features/boards/kanban-api.ts';
import { queryKeys } from '../src/infrastructure/query/keys.ts';
import { createResourceAccess } from '../src/infrastructure/query/resource-access.ts';
import { hintTargets } from '../src/infrastructure/realtime/reconciliation.ts';
import { QueryClient, onlineManager } from '@tanstack/react-query';

const boardId = '00000000-0000-4000-8000-000000000001';
const cardId = '00000000-0000-4000-8000-000000000002';
const labelId = '00000000-0000-4000-8000-000000000003';
const userId = '00000000-0000-4000-8000-000000000004';
const identity = { userId, generation: 1 };
const signal = new globalThis.AbortController().signal;
const date = '2026-02-12T09:00:00.000Z';
const label = { id: labelId, boardId, name: 'Design', color: '#ABC123' };
const assignee = { userId, assignedById: null, createdAt: date };

test('metadata API uses scoped URLs, allowlisted DTOs, exact statuses and empty DELETEs', async () => {
  const requests = [];
  const http = {
    async json(path, decode, opts) {
      requests.push({ path, opts });
      const dto = path.endsWith('assignees')
        ? assignee
        : path.includes('/cards/')
          ? { cardId, labels: [{ ...label, ignored: 'private' }] }
          : label;
      return decode(dto);
    },
    async empty(path, opts) {
      requests.push({ path, opts });
    },
  };
  const api = createMetadataApi(http, identity, boardId, cardId);
  const boardPath = `/boards/${boardId}/labels`;
  const cardPath = `/boards/${boardId}/cards/${cardId}`;
  assert.deepEqual(await api.labels(signal), [
    { id: labelId, name: 'Design', color: '#ABC123' },
  ]);
  assert.deepEqual(await api.assignMember(userId, signal), assignee);
  await api.unassignMember(userId, signal);
  await api.assignLabel(labelId, signal);
  await api.unassignLabel(labelId, signal);
  await api.createLabel({ name: '  Design ', color: '#abc123' }, signal);
  await api.updateLabel(labelId, { color: '#abc123' }, signal);
  await api.deleteLabel(labelId, signal);
  assert.deepEqual(
    requests.map(({ path, opts }) => [
      path,
      opts.method ?? 'GET',
      opts.expectedStatus,
      opts.body,
    ]),
    [
      [cardPath + '/labels', 'GET', 200, undefined],
      [cardPath + '/assignees', 'POST', 201, { userId }],
      [cardPath + '/assignees/' + userId, 'DELETE', 204, undefined],
      [cardPath + '/labels', 'POST', 201, { labelId }],
      [cardPath + '/labels/' + labelId, 'DELETE', 204, undefined],
      [boardPath, 'POST', 201, { name: 'Design', color: '#ABC123' }],
      [boardPath + '/' + labelId, 'PATCH', 200, { color: '#ABC123' }],
      [boardPath + '/' + labelId, 'DELETE', 204, undefined],
    ],
  );
  assert.ok(
    requests.every(
      ({ opts }) =>
        opts.identity === identity &&
        opts.signal === signal &&
        opts.retries === 0,
    ),
  );
  assert.deepEqual(
    requests[0].opts.resourceKey,
    queryKeys.cardLabels(identity, boardId, cardId),
  );
  assert.equal(requests[0].opts.query, undefined);
  assert.throws(() => api.assignMember('bad id', signal), {
    code: 'INVALID_METADATA_INPUT',
  });
  assert.throws(() => api.updateLabel(labelId, {}, signal), {
    code: 'INVALID_METADATA_INPUT',
  });
  assert.throws(() => labelFields({ name: ' ', color: '#fff' }), {
    code: 'INVALID_METADATA_INPUT',
  });
  assert.throws(
    () => labelFields({ name: 'a'.repeat(121), color: '#ABC123' }),
    { code: 'INVALID_METADATA_INPUT' },
  );
  assert.throws(() => labelFields({ name: 'Good', color: '#abc' }), {
    code: 'INVALID_METADATA_INPUT',
  });
  assert.deepEqual(labelPatch(label, label), {});
});

test('read decoders reject foreign Boards/Cards, duplicate associations and invalid response colors', async () => {
  for (const value of [
    null,
    { cardId: userId, labels: [label] },
    { cardId, labels: [label, label] },
    { cardId, labels: [{ ...label, boardId: userId }] },
    { cardId, labels: [{ ...label, color: '#abc' }] },
  ]) {
    const api = createMetadataApi(
      {
        async json(_path, decode) {
          return decode(value);
        },
      },
      identity,
      boardId,
      cardId,
    );
    await assert.rejects(api.labels(signal), { kind: 'invalid-response' });
  }
});

test('Board catalog pagination requests 100 per page even for 0, 1, 100, 101, and 251 rows', async () => {
  for (const count of [0, 1, 100, 101, 251]) {
    const rows = Array.from({ length: count }, (_, i) => ({
      ...label,
      id: labelId.slice(0, -4) + i.toString(16).padStart(4, '0'),
    }));
    const pages = [];
    const api = createKanbanApi(
      {
        async envelope(path, decode, { query }) {
          assert.equal(path, `/boards/${boardId}/labels`);
          assert.equal(query.limit, 100);
          pages.push(query.page);
          return {
            data: decode(rows.slice((query.page - 1) * 100, query.page * 100)),
            meta: {
              page: query.page,
              limit: 100,
              total: count,
              totalPages: Math.ceil(count / 100),
            },
          };
        },
      },
      identity,
      boardId,
    );
    let page;
    const seen = [];
    do {
      page = await api.labels(pages.length + 1, signal);
      seen.push(...page.data.map((item) => item.id));
    } while (page.meta.page < page.meta.totalPages);
    assert.equal(new Set(seen).size, count);
    assert.equal(pages.length, Math.max(1, Math.ceil(count / 100)));
  }
});

test('preferred-zone instants match Web fixtures, including half-hour DST and date boundaries', () => {
  const fromPicker = (date, time) =>
    applyPickerValue(
      new Date(date + 'T00:00:00Z'),
      new Date('2000-01-01T' + time + ':00Z'),
      'time',
    );
  for (const [day, time, zone, expected] of [
    [
      '2026-11-01',
      '01:30',
      'America/New_York',
      ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z'],
    ],
    ['2026-03-08', '02:30', 'America/New_York', []],
    [
      '2026-04-05',
      '01:45',
      'Australia/Lord_Howe',
      ['2026-04-04T14:45:00.000Z', '2026-04-04T15:15:00.000Z'],
    ],
    ['2026-11-02', '00:10', 'Asia/Kathmandu', ['2026-11-01T18:25:00.000Z']],
    [
      '2026-11-01',
      '23:20',
      'America/Los_Angeles',
      ['2026-11-02T07:20:00.000Z'],
    ],
    ['2026-11-02', '23:59', 'UTC', ['2026-11-02T23:59:00.000Z']],
  ]) {
    const wall = fromPicker(day, time);
    assert.deepEqual(resolveWallTime(wall, zone), expected);
    for (const instant of expected)
      assert.equal(wallTime(instant, zone).getTime(), wall.getTime());
  }
  const instant = '2026-11-01T23:20:00.000Z';
  assert.equal(
    describeCardDate(instant, {
      timeZone: 'Asia/Kathmandu',
      dateFormat: 'DD/MM/YYYY',
    }).short,
    '02/11/2026 · 05:05',
  );
  assert.equal(formatOffset(instant, 'Asia/Kathmandu'), 'UTC+05:45');
  assert.equal(
    dueStatus(
      '2026-11-02T05:20:00.000Z',
      'Asia/Kathmandu',
      Date.parse(instant),
    ),
    'DUE_TODAY',
  );
  assert.ok(dateRangeError('dueDate', '2026-02-12T08:00:00.000Z', date));
  assert.equal(dateRangeError('startDate', null, date), undefined);
  assert.equal(dateRangeError('dueDate', date, date), undefined);
});

test('the due status refreshes at local-minute boundaries and immediately after the deadline', () => {
  const value = '2026-11-13T09:00:00.000Z';
  const deadline = Date.parse(value);
  assert.equal(dueClockDelay(value, deadline - 61_000), 1_000);
  assert.equal(dueClockDelay(value, deadline - 500), 500);
  assert.equal(dueClockDelay(value, deadline), 1);
  assert.equal(dueClockDelay(value, deadline + 1), undefined);
  assert.equal(dueStatus(value, 'Asia/Bangkok', deadline), 'DUE_TODAY');
  assert.equal(dueStatus(value, 'Asia/Bangkok', deadline + 1), 'OVERDUE');
});

test('realtime targets and confirmed writes use session-scoped Card, roster, Board labels, filters and preview keys', () => {
  const scope = queryKeys.scope(identity);
  for (const kind of [
    'createLabel',
    'deleteLabel',
    'assignMember',
    'assignLabel',
    'date',
  ]) {
    const keys = metadataTargets(identity, boardId, cardId, kind);
    assert.ok(keys.every((key) => scope.every((val, i) => key[i] === val)));
    assert.ok(keys.some((key) => key[4] === 'home'));
    assert.ok(keys.some((key) => key[4] === 'search'));
    assert.ok(keys.some((key) => key[6] === 'previews'));
    assert.ok(keys.some((key) => key[6] === 'card-lists'));
  }
  assert.ok(
    hintTargets(identity, 'card:updated', { boardId, cardId }).some(
      (key) => key[7] === cardId,
    ),
  );
  assert.ok(
    hintTargets(identity, 'labels:changed', { boardId, labelId }).some(
      (key) => key[6] === 'labels',
    ),
  );
  assert.ok(
    hintTargets(identity, 'member:removed', { boardId, userId }).some(
      (key) => key[6] === 'cards',
    ),
  );
});

test('mutation gate rejects offline, revoked, archived, rapid, and late session writes', async () => {
  const queryClient = new QueryClient();
  const resources = createResourceAccess();
  const boardKey = queryKeys.board(identity, boardId);
  const cardKey = queryKeys.card(identity, boardId, cardId);
  const board = {
    isArchived: false,
    capabilities: { canReadBoard: true, canWriteBoard: true },
  };
  const card = { isArchived: false, startDate: date, dueDate: date };
  queryClient.setQueryData(boardKey, board);
  queryClient.setQueryData(cardKey, card);
  let active = identity;
  let complete;
  let requests = 0;
  let invalidations = 0;
  const data = {
    queryClient,
    resources,
    getIdentity: () => active,
    assertCurrent: () => {
      if (active !== identity) throw new Error('old session');
    },
    invalidate: async () => {
      invalidations++;
    },
    api: {
      empty() {
        requests++;
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    },
  };
  const remove = { kind: 'unassignMember', id: userId };
  const commit = (command = remove) =>
    runMetadataMutation(data, identity, boardId, cardId, command, signal);
  await commit({
    kind: 'date',
    field: 'dueDate',
    original: date,
    value: date,
    zone: 'UTC',
  });
  assert.equal(invalidations, 0);
  onlineManager.setOnline(false);
  try {
    await assert.rejects(commit(), { kind: 'offline' });
  } finally {
    onlineManager.setOnline(true);
  }
  queryClient.setQueryData(cardKey, { ...card, isArchived: true });
  await assert.rejects(commit(), { status: 403 });
  queryClient.setQueryData(cardKey, card);
  const write = commit();
  await assert.rejects(commit(), { code: 'METADATA_PENDING' });
  assert.equal(requests, 1);
  active = { ...identity, generation: 2 };
  complete();
  await assert.rejects(write, /old session/);
  assert.equal(invalidations, 0);
  active = identity;
  resources.fenceBoard(boardId, true);
  await assert.rejects(commit(), { code: 'RESOURCE_ACCESS_CHANGED' });
  queryClient.clear();
});
