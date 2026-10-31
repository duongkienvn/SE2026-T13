import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export async function verifyLabelRaces(ctx) {
  const {
    source,
    service,
    cards,
    members,
    actors,
    board,
    foreignBoard,
    card,
    secondCard,
    secondColumn,
    pass,
  } = ctx;
  const create = (name) =>
    service.create(actors.owner, board.id, { name, color: '#123456' });
  const race = async (first, second) => {
    const runner = source.createQueryRunner(),
      tasks = [];
    const waiters = async (count) => {
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        const [row] = await source.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`,
        );
        if (row.n >= count) return;
        await delay(10);
      }
      throw new Error(`Expected ${count} PostgreSQL lock waiters`);
    };
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
  const concurrent = await Promise.allSettled([create('Race'), create('rAcE')]);
  assert.equal(
    concurrent.filter((row) => row.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    concurrent.find((row) => row.status === 'rejected').reason.getStatus(),
    409,
  );
  const a = await create('Rename A'),
    b = await create('Rename B');
  const renamed = await Promise.allSettled([
    service.update(actors.owner, board.id, a.id, { name: 'Collision' }),
    service.update(actors.member, board.id, b.id, { name: 'COLLISION' }),
  ]);
  assert.equal(renamed.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(
    renamed.find((row) => row.status === 'rejected').reason.getStatus(),
    409,
  );
  const patched = await race(
    () => service.update(actors.member, board.id, a.id, { name: 'Patched' }),
    () => service.update(actors.owner, board.id, a.id, { color: '#AABBCC' }),
  );
  assert.ok(patched.every((row) => !row.error));
  assert.deepEqual(
    (
      await source.query('SELECT name,color FROM board_labels WHERE id=$1', [
        a.id,
      ])
    )[0],
    { name: 'Patched', color: '#AABBCC' },
  );
  const duplicates = await Promise.allSettled([
    service.assign(actors.owner, board.id, card.id, a.id),
    service.assign(actors.member, board.id, card.id, a.id),
  ]);
  assert.equal(
    duplicates.filter((row) => row.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    duplicates.find((row) => row.status === 'rejected').reason.getStatus(),
    409,
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM card_labels WHERE card_id=$1 AND label_id=$2',
        [card.id, a.id],
      )
    )[0].n,
    1,
  );
  pass(
    'concurrent case-insensitive create/rename, disjoint label patches and duplicate assignment preserve committed state',
  );

  for (const deleteFirst of [false, true]) {
    const label = await create(`Delete ${deleteFirst}`);
    const assign = () =>
        service.assign(actors.owner, board.id, card.id, label.id),
      remove = () => service.remove(actors.owner, board.id, label.id);
    const result = await race(
      deleteFirst ? remove : assign,
      deleteFirst ? assign : remove,
    );
    assert.ok(!result[0].error);
    if (deleteFirst) assert.equal(result[1].error.getStatus(), 404);
    else assert.ok(!result[1].error);
    assert.equal(
      (
        await source.query(
          'SELECT count(*)::int AS n FROM card_labels WHERE label_id=$1',
          [label.id],
        )
      )[0].n,
      0,
    );
  }
  for (const archiveFirst of [false, true]) {
    const label = await create(`Archive ${archiveFirst}`);
    const archive = () => cards.archive(actors.owner, board.id, card.id),
      assign = () => service.assign(actors.owner, board.id, card.id, label.id);
    const result = await race(
      archiveFirst ? archive : assign,
      archiveFirst ? assign : archive,
    );
    assert.ok(!result[0].error);
    if (archiveFirst) assert.equal(result[1].error.getStatus(), 409);
    else assert.ok(!result[1].error);
    await cards.restore(actors.owner, board.id, card.id);
  }
  const moving = await create('Move race');
  const moved = await race(
    () =>
      cards.move(actors.owner, board.id, card.id, {
        toColumnId: secondColumn.id,
        beforeCardId: null,
      }),
    () => service.assign(actors.member, board.id, card.id, moving.id),
  );
  assert.ok(moved.every((row) => !row.error));
  for (const removalFirst of [false, true]) {
    const label = await create(`Membership ${removalFirst}`);
    const remove = () => members.remove(actors.owner, board.id, actors.member),
      assign = () => service.assign(actors.member, board.id, card.id, label.id);
    const result = await race(
      removalFirst ? remove : assign,
      removalFirst ? assign : remove,
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
    'observed Board lock races cover catalog delete vs assign, Card archive/move and member revocation in both acquisition orders',
  );

  const rollback = await create('Rollback cascade');
  await service.assign(actors.owner, board.id, card.id, rollback.id);
  await service.assign(actors.owner, board.id, secondCard.id, rollback.id);
  await source.query(
    `CREATE FUNCTION labels_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.label_id='${rollback.id}'::uuid THEN RAISE EXCEPTION 'injected deletion failure'; END IF; RETURN OLD; END $$`,
  );
  await source.query(
    'CREATE TRIGGER labels_failure BEFORE DELETE ON card_labels FOR EACH ROW EXECUTE FUNCTION labels_injected_failure()',
  );
  try {
    await assert.rejects(
      service.remove(actors.owner, board.id, rollback.id),
      /injected deletion failure/,
    );
    assert.equal(
      (
        await source.query(
          'SELECT count(*)::int AS n FROM card_labels WHERE label_id=$1',
          [rollback.id],
        )
      )[0].n,
      2,
    );
    assert.equal(
      (
        await source.query(
          'SELECT count(*)::int AS n FROM board_labels WHERE id=$1',
          [rollback.id],
        )
      )[0].n,
      1,
    );
  } finally {
    await source.query('DROP TRIGGER labels_failure ON card_labels');
    await source.query('DROP FUNCTION labels_injected_failure()');
  }
  await service.remove(actors.owner, board.id, rollback.id);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM card_labels WHERE label_id=$1',
        [rollback.id],
      )
    )[0].n,
    0,
  );
  pass(
    'injected cascade failure rolls back catalog deletion and every link; retry deletes atomically',
  );

  await source.query('DELETE FROM board_labels WHERE board_id=$1', [
    foreignBoard.id,
  ]);
  await source.query(
    `INSERT INTO board_labels(board_id,name,color) SELECT $1,'Quota '||n,'#123456' FROM generate_series(1,199) n`,
    [foreignBoard.id],
  );
  const quotas = await Promise.allSettled(
    [1, 2].map((i) =>
      service.create(actors.owner, foreignBoard.id, {
        name: `Quota race ${i}`,
        color: '#123456',
      }),
    ),
  );
  assert.equal(quotas.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(
    quotas.find((row) => row.status === 'rejected').reason.getStatus(),
    409,
  );
  const [column] = await source.query(
    `INSERT INTO board_columns(board_id,name,position) VALUES ($1,'Quota',100) RETURNING id`,
    [foreignBoard.id],
  );
  const [quotaCard] = await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position) VALUES ($1,$2,$3,'Quota',100) RETURNING id`,
    [foreignBoard.id, column.id, actors.owner],
  );
  await source.query(
    `INSERT INTO card_labels(card_id,label_id,board_id) SELECT $1,id,board_id FROM board_labels WHERE board_id=$2`,
    [quotaCard.id, foreignBoard.id],
  );
  assert.equal(
    (await service.cardLabels(actors.owner, foreignBoard.id, quotaCard.id))
      .labels.length,
    200,
  );
  for (const page of [1, 2])
    assert.equal(
      (await service.list(actors.owner, foreignBoard.id, { page, limit: 100 }))
        .data.length,
      100,
    );
  await source.query('DELETE FROM cards WHERE id=$1', [quotaCard.id]);
  await source.query('DELETE FROM board_columns WHERE id=$1', [column.id]);
  pass(
    'concurrent catalog cap is enforced; maximum-size catalog paging and Card association reads include all 200 labels',
  );
}
