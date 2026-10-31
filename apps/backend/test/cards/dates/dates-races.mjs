import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export async function verifyDateRaces(ctx) {
  const { source, service, members, actors, board, card, pass } = ctx;
  const update = (input) =>
    service.update(actors.owner, board.id, card.id, input);
  const row = async () =>
    (
      await source.query(
        'SELECT start_date,due_date,updated_at FROM cards WHERE id=$1',
        [card.id],
      )
    )[0];
  const activityCount = async () =>
    (
      await source.query(
        `SELECT count(*)::int AS n FROM activities WHERE entity_id=$1 AND action_type='CARD_UPDATED'`,
        [card.id],
      )
    )[0].n;
  const race = async (first, second) => {
    const runner = source.createQueryRunner(),
      tasks = [];
    const start = (operation) =>
      operation().then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    const waiters = async (count) => {
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        const [state] = await source.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'`,
        );
        if (state.n >= count) return;
        await delay(10);
      }
      throw new Error(`Expected ${count} Board lock waiters`);
    };
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
  await update({
    startDate: '2026-03-01T00:00Z',
    dueDate: '2026-04-01T00:00Z',
  });
  const disjoint = await race(
    () => update({ startDate: '2026-03-02T00:00Z' }),
    () => update({ dueDate: '2026-04-02T00:00Z' }),
  );
  assert.ok(disjoint.every((result) => !result.error));
  assert.equal(
    (await row()).start_date.toISOString(),
    '2026-03-02T00:00:00.000Z',
  );
  assert.equal(
    (await row()).due_date.toISOString(),
    '2026-04-02T00:00:00.000Z',
  );
  for (const startFirst of [false, true]) {
    await update({
      startDate: '2026-03-01T00:00Z',
      dueDate: '2026-03-10T00:00Z',
    });
    const before = await activityCount();
    const start = () => update({ startDate: '2026-03-08T00:00Z' }),
      due = () => update({ dueDate: '2026-03-05T00:00Z' });
    const result = await race(
      startFirst ? start : due,
      startFirst ? due : start,
    );
    assert.ok(!result[0].error);
    assert.equal(result[1].error.getStatus(), 400);
    assert.equal(await activityCount(), before + 1);
    assert.ok(
      (await row()).start_date.getTime() <= (await row()).due_date.getTime(),
    );
  }
  pass(
    'observed concurrent PATCH locks preserve omitted fields and reject the stale-counterpart range in either order, with one Activity',
  );

  for (const archiveFirst of [false, true]) {
    await update({ startDate: null, dueDate: '2026-12-01T00:00Z' });
    const archive = () => service.archive(actors.owner, board.id, card.id),
      change = () => update({ startDate: '2026-11-01T00:00Z' });
    const result = await race(
      archiveFirst ? archive : change,
      archiveFirst ? change : archive,
    );
    assert.ok(!result[0].error);
    if (archiveFirst) assert.equal(result[1].error.getStatus(), 409);
    else assert.ok(!result[1].error);
    const archived = await row();
    await service.restore(actors.owner, board.id, card.id);
    const restored = await row();
    assert.equal(
      restored.start_date?.getTime(),
      archived.start_date?.getTime(),
    );
    assert.equal(restored.due_date?.getTime(), archived.due_date?.getTime());
  }
  for (const restoreFirst of [false, true]) {
    await service.archive(actors.owner, board.id, card.id);
    const restore = () => service.restore(actors.owner, board.id, card.id),
      change = () => update({ dueDate: '2026-12-03T00:00Z' });
    const result = await race(
      restoreFirst ? restore : change,
      restoreFirst ? change : restore,
    );
    if (restoreFirst) assert.ok(result.every((value) => !value.error));
    else {
      assert.equal(result[0].error.getStatus(), 409);
      assert.ok(!result[1].error);
    }
  }
  for (const removalFirst of [false, true]) {
    await update({ startDate: null, dueDate: '2026-12-01T00:00Z' });
    const remove = () => members.remove(actors.owner, board.id, actors.member),
      change = () =>
        service.update(actors.member, board.id, card.id, {
          dueDate: '2026-12-02T00:00Z',
        });
    const result = await race(
      removalFirst ? remove : change,
      removalFirst ? change : remove,
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
    'Card date update/archive/restore and member revocation races preserve dates and write authorization in both lock orders',
  );

  const before = await row(),
    count = await activityCount();
  await source.query(
    `CREATE FUNCTION dates_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id='${card.id}'::uuid AND NEW.action_type='CARD_UPDATED' THEN RAISE EXCEPTION 'injected date activity failure'; END IF; RETURN NEW; END $$`,
  );
  await source.query(
    'CREATE TRIGGER dates_failure BEFORE INSERT ON activities FOR EACH ROW EXECUTE FUNCTION dates_injected_failure()',
  );
  try {
    await assert.rejects(
      update({ startDate: '2026-11-01T00:00Z' }),
      /injected date activity failure/,
    );
    assert.deepEqual(await row(), before);
    assert.equal(await activityCount(), count);
  } finally {
    await source.query('DROP TRIGGER dates_failure ON activities');
    await source.query('DROP FUNCTION dates_injected_failure()');
  }
  await update({ startDate: '2026-11-01T00:00Z' });
  assert.equal(await activityCount(), count + 1);
  pass(
    'Activity failure after the Card date SQL write rolls back dates/timestamps/history; the same request succeeds on retry',
  );
}
