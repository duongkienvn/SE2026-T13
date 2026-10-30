// VT-052 PostgreSQL checks for bulk card import (real transactions, locks and
// constraints). Run from apps/backend: pnpm test:cards-import:database
import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';
import { withImportDatabase } from './cards-import.setup.mjs';

const require = createRequire(import.meta.url);
const {
  ActivityWriterService,
} = require('../../dist/api/activities/activity-writer.service.js');

let checks = 0;
const pass = (name) => {
  checks++;
  console.log(`PASS: ${name}`);
};
const status = async (promise) => {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error.getStatus?.() ?? error.message;
  }
};

await withImportDatabase('kanban_import_verify', async (ctx) => {
  const { repos, published, makeCards, columnService } = ctx;
  const owner = await ctx.user('owner');
  const member = await ctx.user('member');
  const outsider = await ctx.user('outsider');
  const board = await ctx.board('Import', owner, [member]);
  const service = makeCards();
  const column = await columnService.create(owner.id, board.id, {
    name: 'Inbox',
  });
  const active = () =>
    repos.cards.find({
      where: { boardId: board.id, columnId: column.id, isArchived: false },
      order: { position: 'ASC', id: 'ASC' },
    });
  const imported = (items, actor = member.id) =>
    service.importCards(actor, board.id, { columnId: column.id, items });

  // TC14 partial success persists exactly the ACCEPTED rows, in order.
  await service.create(owner.id, board.id, {
    columnId: column.id,
    title: 'Existing',
  });
  const first = await imported([
    { title: 'Row 0' },
    { title: 'x'.repeat(121) },
    { title: 'Row 2', dueDate: '2000-01-01T07:00:00+07:00' },
    { title: 'Row 3', unknown: true },
    { title: 'Row 4' },
  ]);
  assert.equal(first.createdCount, 3);
  assert.deepEqual(
    first.rejected.map((row) => row.index),
    [1, 3],
  );
  const afterFirst = await active();
  assert.deepEqual(
    afterFirst.map((card) => card.title),
    ['Existing', 'Row 0', 'Row 2', 'Row 4'],
  );
  assert.deepEqual(
    afterFirst.map((card) => card.position),
    ['100.0000000000', '200.0000000000', '300.0000000000', '400.0000000000'],
  );
  assert.equal(afterFirst[2].dueDate.toISOString(), '2000-01-01T00:00:00.000Z');
  assert.equal(
    await repos.activities.countBy({
      boardId: board.id,
      actionType: 'CARD_CREATED',
    }),
    4,
  );
  // 1 from the setup create + 3 imported rows; rejected rows publish nothing.
  assert.equal(published.filter((e) => e === 'card:created').length, 4);
  pass('TC14 partial success persists only ACCEPTED rows with activities');

  // TC15 failure path: an error after some INSERTs rolls the whole batch back.
  let writes = 0;
  const flaky = new ActivityWriterService();
  const record = flaky.record.bind(flaky);
  flaky.record = async (...args) => {
    if (++writes === 2) throw new Error('simulated activity write failure');
    return record(...args);
  };
  const publishedBefore = published.length;
  assert.equal(
    await status(
      makeCards(flaky).importCards(member.id, board.id, {
        columnId: column.id,
        items: [{ title: 'Lost 1' }, { title: 'Lost 2' }, { title: 'Lost 3' }],
      }),
    ),
    'simulated activity write failure',
  );
  assert.equal(writes, 2);
  assert.deepEqual(
    (await active()).map((card) => card.title),
    afterFirst.map((card) => card.title),
  );
  assert.equal(await repos.cards.countBy({ title: 'Lost 1' }), 0);
  assert.equal(published.length, publishedBefore);
  pass('TC15 mid-batch failure rolls back every row and publishes nothing');

  // TC16 concurrent imports and single creates share the Board lock.
  const results = await Promise.all([
    ...Array.from({ length: 10 }, (_, batch) =>
      imported(
        Array.from({ length: 10 }, (_, row) => ({ title: `B${batch}-${row}` })),
      ),
    ),
    ...Array.from({ length: 10 }, (_, index) =>
      service.create(owner.id, board.id, {
        columnId: column.id,
        title: `Single ${index}`,
      }),
    ),
  ]);
  const rows = await active();
  assert.equal(rows.length, 4 + 100 + 10);
  assert.equal(new Set(rows.map((card) => card.position)).size, rows.length);
  for (const result of results.slice(0, 10)) {
    const ids = result.created.map((card) => card.id);
    const start = rows.findIndex((card) => card.id === ids[0]);
    assert.deepEqual(
      rows.slice(start, start + ids.length).map((card) => card.id),
      ids,
      'each import lands as one contiguous block',
    );
  }
  pass('TC16 10 concurrent imports + 10 creates keep unique, contiguous order');

  // TC17 state chain: imported card ACTIVE -> ARCHIVED -> ACTIVE; board guard.
  const card = first.created[0];
  await service.archive(member.id, board.id, card.id);
  const restored = await service.restore(member.id, board.id, card.id);
  assert.equal(restored.isArchived, false);
  assert.ok(Number(restored.position) > Number(rows.at(-1).position));
  await repos.boards.update(board.id, {
    isArchived: true,
    archivedAt: new Date(),
  });
  const countArchived = await repos.cards.countBy({ boardId: board.id });
  assert.equal(await status(imported([{ title: 'Blocked' }])), 409);
  assert.equal(await repos.cards.countBy({ boardId: board.id }), countArchived);
  await repos.boards.update(board.id, { isArchived: false, archivedAt: null });
  assert.equal((await imported([{ title: 'Back' }])).createdCount, 1);
  assert.equal(await status(imported([{ title: 'No' }], outsider.id)), 404);
  pass('TC17 imported card archive/restore and archived/restored Board guard');

  console.log(`Card import PostgreSQL integration: ${checks} groups PASS`);
});
