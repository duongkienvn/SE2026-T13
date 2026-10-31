import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export async function verifyAttachmentRaces(ctx) {
  const {
    source,
    service,
    cards,
    members,
    actors,
    board,
    card,
    createCard,
    pass,
  } = ctx;
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

  const create = (cardId, key, user = actors.owner) =>
    service.create(
      user,
      board.id,
      cardId,
      { kind: 'URL', url: 'https://example.com/race' },
      key,
    );
  const once = randomUUID();
  const replayed = await Promise.all([
    create(card.id, once),
    create(card.id, once),
  ]);
  assert.equal(replayed[0].id, replayed[1].id);
  const row = replayed[0];
  const patches = await race(
    () =>
      service.update(actors.member, board.id, card.id, row.id, {
        expectedRevision: 1,
        displayName: 'First',
      }),
    () =>
      service.update(actors.owner, board.id, card.id, row.id, {
        expectedRevision: 1,
        url: 'https://example.com/second',
      }),
  );
  assert.ok(patches[0].value);
  assert.equal(patches[1].error.getStatus(), 409);
  const quota = await createCard('Quota race');
  const pendingId = randomUUID();
  await source.query(
    `INSERT INTO card_attachments(id,card_id,board_id,uploader_id,kind,state,display_name,original_filename,pending_key,storage_key,requested_mime_type,reserved_bytes,expires_at)
    VALUES ($1::uuid,$2,$3,$4,'FILE','PENDING','Pending','pending.txt','attachments/v1/pending/'||$1::text,'attachments/v1/active/'||$1::text,'text/plain',4096,now()+interval '15 minutes')`,
    [pendingId, quota.id, board.id, actors.owner],
  );
  await source.query(
    `INSERT INTO card_attachments(card_id,board_id,uploader_id,kind,state,display_name,url) SELECT $1,$2,$3,'URL','ACTIVE','Quota','https://example.com/'||i FROM generate_series(1,18) i`,
    [quota.id, board.id, actors.owner],
  );
  const full = await race(
    () => create(quota.id),
    () => create(quota.id),
  );
  assert.ok(full[0].value);
  assert.equal(full[1].error.getStatus(), 409);
  assert.equal(
    (
      await source.query(
        "SELECT count(*)::int AS n FROM card_attachments WHERE card_id=$1 AND state IN ('PENDING','ACTIVE')",
        [quota.id],
      )
    )[0].n,
    20,
  );
  const slotId = full[0].value.id;
  const freed = await race(
    () => service.remove(actors.owner, board.id, quota.id, slotId),
    () => create(quota.id),
  );
  assert.ok(freed.every((result) => !result.error));
  const blocked = await race(
    () => create(quota.id),
    () => service.remove(actors.owner, board.id, quota.id, freed[1].value.id),
  );
  assert.equal(blocked[0].error.getStatus(), 409);
  assert.ok(!blocked[1].error);
  pass(
    'observed Board lock waiters serialize duplicate POST, stale revisions and quota create/delete races deterministically',
  );

  for (const firstArchive of [false, true]) {
    const target = await create(card.id);
    const edit = () =>
        service.update(actors.member, board.id, card.id, target.id, {
          expectedRevision: 1,
          displayName: 'Edited',
        }),
      archive = () => cards.archive(actors.owner, board.id, card.id);
    const result = await race(
      firstArchive ? archive : edit,
      firstArchive ? edit : archive,
    );
    assert.ok(!result[0].error);
    if (firstArchive) assert.equal(result[1].error.getStatus(), 409);
    else assert.ok(!result[1].error);
    await cards.restore(actors.owner, board.id, card.id);
    const remove = () =>
        service.remove(actors.member, board.id, card.id, target.id),
      revoke = () => members.remove(actors.owner, board.id, actors.member);
    const revoked = await race(
      firstArchive ? revoke : remove,
      firstArchive ? remove : revoke,
    );
    assert.ok(!revoked[0].error);
    if (firstArchive) assert.equal(revoked[1].error.getStatus(), 404);
    else assert.ok(!revoked[1].error);
    await source.query(
      `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
      [board.id, actors.member],
    );
    const current = await create(card.id);
    const change = () =>
        service.update(actors.owner, board.id, card.id, current.id, {
          expectedRevision: 1,
          displayName: 'Edit before remove',
        }),
      detach = () =>
        service.remove(actors.owner, board.id, card.id, current.id);
    const removal = await race(
      firstArchive ? detach : change,
      firstArchive ? change : detach,
    );
    assert.ok(!removal[0].error);
    if (firstArchive) assert.equal(removal[1].error.getStatus(), 404);
    else assert.ok(!removal[1].error);
  }
  pass(
    'archive, authorization revocation and edit/delete races preserve read-only rules and prevent resurrection in both lock orders',
  );

  const key = randomUUID();
  const before = (
    await source.query('SELECT count(*)::int AS n FROM card_attachments')
  )[0].n;
  await source.query(
    `CREATE FUNCTION attachments_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.card_id='${card.id}'::uuid THEN RAISE EXCEPTION 'injected attachment write failure'; END IF; RETURN NEW; END $$`,
  );
  await source.query(
    'CREATE TRIGGER attachments_injected_failure AFTER INSERT ON card_attachments FOR EACH ROW EXECUTE FUNCTION attachments_injected_failure()',
  );
  try {
    await assert.rejects(
      create(card.id, key),
      /injected attachment write failure/,
    );
  } finally {
    await source.query(
      'DROP TRIGGER attachments_injected_failure ON card_attachments',
    );
    await source.query('DROP FUNCTION attachments_injected_failure()');
  }
  assert.equal(
    (await source.query('SELECT count(*)::int AS n FROM card_attachments'))[0]
      .n,
    before,
  );
  await create(card.id, key);
  pass(
    'failure after attachment INSERT rolls back quota, idempotency and row state, allowing a clean retry',
  );
}
