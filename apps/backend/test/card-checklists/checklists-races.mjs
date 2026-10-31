import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export async function verifyChecklistRaces(ctx) {
  const {
    source,
    service,
    cards,
    members,
    actors,
    board,
    card,
    secondCard,
    secondColumn,
    pass,
  } = ctx;
  const create = (title) =>
    service.create(actors.owner, board.id, card.id, { title });
  const add = (id, text) =>
    service.addItem(actors.owner, board.id, card.id, id, { text });
  const list = () => service.list(actors.owner, board.id, card.id);
  const unique = (rows) =>
    assert.equal(new Set(rows.map((row) => row.position)).size, rows.length);
  const waiters = async (count) => {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const [row] = await source.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`,
      );
      if (row.n >= count) return;
      await delay(10);
    }
    throw new Error(`Expected ${count} database lock waiters`);
  };
  const race = async (first, second) => {
    const runner = source.createQueryRunner(),
      tasks = [];
    const start = (operation) =>
      operation().then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [
        board.id,
      ]);
      tasks.push(start(first));
      await waiters(1);
      tasks.push(start(second));
      await waiters(2);
      await runner.commitTransaction();
      return await Promise.all(tasks);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await Promise.all(tasks);
      await runner.release();
    }
  };
  const created = await Promise.all(
    Array.from({ length: 8 }, (_, i) => create(`Concurrent ${i}`)),
  );
  unique((await list()).checklists);
  const parent = created[0];
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => add(parent.id, `Item ${i}`)),
  );
  let items = (await list()).checklists.find(
    (row) => row.id === parent.id,
  ).items;
  unique(items);
  assert.equal(items.length, 12);
  const target = items[0];
  const [textUpdate, checkedUpdate] = await race(
    () =>
      service.updateItem(
        actors.member,
        board.id,
        card.id,
        parent.id,
        target.id,
        { text: 'Concurrent edit' },
      ),
    () =>
      service.updateItem(
        actors.owner,
        board.id,
        card.id,
        parent.id,
        target.id,
        { isChecked: true },
      ),
  );
  assert.ok(textUpdate.value && checkedUpdate.value);
  items = (await list()).checklists.find((row) => row.id === parent.id).items;
  assert.equal(items[0].text, 'Concurrent edit');
  assert.equal(items[0].isChecked, true);
  await Promise.all(
    items.map((item) =>
      service.updateItem(actors.owner, board.id, card.id, parent.id, item.id, {
        isChecked: true,
      }),
    ),
  );
  const complete = (await list()).checklists.find(
    (row) => row.id === parent.id,
  );
  assert.equal(complete.checkedItems, 12);
  assert.equal(complete.completionPercentage, 100);
  pass(
    'concurrent checklist/item creation, field patches and atomic explicit checked states preserve progress and updates',
  );

  const dense = async (table, parentField, parentId) =>
    source.query(
      `UPDATE ${table} t SET position = sorted.n * 0.0000000001::numeric FROM (SELECT id,row_number() OVER (ORDER BY position,id) AS n FROM ${table} WHERE ${parentField}=$1) sorted WHERE t.id=sorted.id`,
      [parentId],
    );
  let checklists = (await list()).checklists;
  const denseMovingId = checklists.at(-1).id;
  await dense('card_checklists', 'card_id', card.id);
  await service.move(
    actors.owner,
    board.id,
    card.id,
    checklists.at(-1).id,
    checklists[1].id,
  );
  checklists = (await list()).checklists;
  unique(checklists);
  assert.equal(checklists[1].id, denseMovingId);
  assert.equal(checklists[0].position, '100.0000000000');
  await source.query(
    'UPDATE card_checklists SET position=9999999999.9999999999 WHERE id=$1',
    [checklists.at(-1).id],
  );
  await create('Overflow append');
  unique((await list()).checklists);
  await dense('card_checklist_items', 'checklist_id', parent.id);
  await service.moveItem(
    actors.owner,
    board.id,
    card.id,
    parent.id,
    items.at(-1).id,
    items[1].id,
  );
  items = (await list()).checklists.find((row) => row.id === parent.id).items;
  assert.equal(items[0].position, '100.0000000000');
  unique(items);
  pass(
    'dense checklist/item reorder and numeric overflow append rebalance exact persisted positions atomically',
  );

  await dense('card_checklist_items', 'checklist_id', parent.id);
  const snapshot = () =>
    source.query(
      'SELECT id,position,text,is_checked,updated_at FROM card_checklist_items WHERE checklist_id=$1 ORDER BY position,id',
      [parent.id],
    );
  const before = await snapshot();
  await source.query(
    `CREATE FUNCTION checklist_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${before[2].id}'::uuid THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$`,
  );
  await source.query(
    'CREATE TRIGGER checklist_failure BEFORE UPDATE ON card_checklist_items FOR EACH ROW EXECUTE FUNCTION checklist_injected_failure()',
  );
  try {
    await assert.rejects(
      service.moveItem(
        actors.owner,
        board.id,
        card.id,
        parent.id,
        before.at(-1).id,
        before[1].id,
      ),
      /injected failure/,
    );
    assert.deepEqual(await snapshot(), before);
  } finally {
    await source.query(
      'DROP TRIGGER checklist_failure ON card_checklist_items',
    );
    await source.query('DROP FUNCTION checklist_injected_failure()');
  }
  await service.moveItem(
    actors.owner,
    board.id,
    card.id,
    parent.id,
    before.at(-1).id,
    before[1].id,
  );
  unique((await list()).checklists.find((row) => row.id === parent.id).items);
  pass(
    'injected mid-rebalance failure fully rolls back positions/timestamps; retry succeeds',
  );

  for (const deleteFirst of [false, true]) {
    const a = await create('Anchor'),
      b = await create('Between'),
      moving = await create('Moving');
    const remove = () => service.remove(actors.owner, board.id, card.id, a.id);
    const move = () =>
      service.move(actors.owner, board.id, card.id, moving.id, a.id);
    const result = await race(
      deleteFirst ? remove : move,
      deleteFirst ? move : remove,
    );
    assert.ok(result[0].value || !result[0].error);
    if (deleteFirst) assert.equal(result[1].error.getStatus(), 404);
    else assert.ok(!result[1].error);
    await service.remove(actors.owner, board.id, card.id, b.id);
    await service.remove(actors.owner, board.id, card.id, moving.id);
    const itemParent = await create('Toggle/delete');
    const item = (await add(itemParent.id, 'One')).items[0];
    const del = () =>
      service.removeItem(
        actors.owner,
        board.id,
        card.id,
        itemParent.id,
        item.id,
      );
    const toggle = () =>
      service.updateItem(
        actors.owner,
        board.id,
        card.id,
        itemParent.id,
        item.id,
        { isChecked: true },
      );
    const toggled = await race(
      deleteFirst ? del : toggle,
      deleteFirst ? toggle : del,
    );
    if (deleteFirst) assert.equal(toggled[1].error.getStatus(), 404);
    else assert.ok(!toggled[1].error);
    const empty = (await list()).checklists.find(
      (row) => row.id === itemParent.id,
    );
    assert.equal(empty.totalItems, 0);
    assert.equal(empty.completionPercentage, 0);
    await service.remove(actors.owner, board.id, card.id, itemParent.id);
  }
  // Item anchor deletion and two competing reorders use the same lock protocol.
  const anchorParent = await create('Item reorder races');
  let anchorItems;
  for (const text of ['A', 'B', 'C'])
    anchorItems = (await add(anchorParent.id, text)).items;
  await Promise.all([
    service.moveItem(
      actors.owner,
      board.id,
      card.id,
      anchorParent.id,
      anchorItems[2].id,
      anchorItems[0].id,
    ),
    service.moveItem(
      actors.member,
      board.id,
      card.id,
      anchorParent.id,
      anchorItems[1].id,
      null,
    ),
  ]);
  unique(
    (await list()).checklists.find((row) => row.id === anchorParent.id).items,
  );
  const itemRace = await race(
    () =>
      service.removeItem(
        actors.owner,
        board.id,
        card.id,
        anchorParent.id,
        anchorItems[0].id,
      ),
    () =>
      service.moveItem(
        actors.owner,
        board.id,
        card.id,
        anchorParent.id,
        anchorItems[1].id,
        anchorItems[0].id,
      ),
  );
  assert.equal(itemRace[1].error.getStatus(), 404);
  pass(
    'ordered PostgreSQL lock races: reorder/delete anchors in both orders, toggle/delete, competing item reorders and deleted item anchor',
  );

  for (const archiveFirst of [false, true]) {
    const archive = () => cards.archive(actors.owner, board.id, card.id);
    const update = () => add(parent.id, 'Archive race');
    const result = await race(
      archiveFirst ? archive : update,
      archiveFirst ? update : archive,
    );
    assert.ok(!result[0].error);
    if (archiveFirst) assert.equal(result[1].error.getStatus(), 409);
    else assert.ok(!result[1].error);
    await cards.restore(actors.owner, board.id, card.id);
  }
  const moved = await race(
    () =>
      cards.move(actors.owner, board.id, card.id, {
        toColumnId: secondColumn.id,
        beforeCardId: null,
      }),
    () => add(parent.id, 'Move race'),
  );
  assert.ok(moved.every((result) => !result.error));
  for (const removalFirst of [false, true]) {
    const remove = () => members.remove(actors.owner, board.id, actors.member);
    const update = () =>
      service.updateItem(
        actors.member,
        board.id,
        card.id,
        parent.id,
        target.id,
        { isChecked: !removalFirst },
      );
    const result = await race(
      removalFirst ? remove : update,
      removalFirst ? update : remove,
    );
    assert.ok(!result[0].error);
    if (removalFirst) assert.equal(result[1].error.getStatus(), 404);
    else assert.ok(!result[1].error);
    await source.query(
      `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
      [board.id, actors.member],
    );
  }
  pass(
    'Card archive/move and Board membership revocation serialize with checklist writes in both lock orders',
  );

  await source.query(
    `INSERT INTO card_checklists(card_id,title,position) SELECT $1,'Quota '||n,n*100 FROM generate_series(1,49) n`,
    [secondCard.id],
  );
  const quotas = await Promise.allSettled(
    [1, 2].map((i) =>
      service.create(actors.owner, board.id, secondCard.id, {
        title: `Quota race ${i}`,
      }),
    ),
  );
  assert.equal(quotas.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(
    quotas.find((row) => row.status === 'rejected').reason.getStatus(),
    409,
  );
  const [quotaParent] = await source.query(
    'SELECT id FROM card_checklists WHERE card_id=$1 ORDER BY position LIMIT 1',
    [secondCard.id],
  );
  await source.query(
    `INSERT INTO card_checklist_items(checklist_id,text,position) SELECT $1,'Quota '||n,n*100 FROM generate_series(1,199) n`,
    [quotaParent.id],
  );
  const itemQuotas = await Promise.allSettled(
    [1, 2].map((i) =>
      service.addItem(actors.owner, board.id, secondCard.id, quotaParent.id, {
        text: `Quota item ${i}`,
      }),
    ),
  );
  assert.equal(
    itemQuotas.filter((row) => row.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    itemQuotas.find((row) => row.status === 'rejected').reason.getStatus(),
    409,
  );
  const boundedDetail = await service.list(
    actors.owner,
    board.id,
    secondCard.id,
  );
  assert.equal(boundedDetail.checklists.length, 50);
  assert.equal(boundedDetail.totalItems, 200);
  assert.equal(
    boundedDetail.checklists.find((row) => row.id === quotaParent.id).items
      .length,
    200,
  );
  await source.query('DELETE FROM card_checklists WHERE card_id=$1', [
    secondCard.id,
  ]);
  pass(
    'concurrent requests cannot exceed the bounded checklist or item limits',
  );
}
