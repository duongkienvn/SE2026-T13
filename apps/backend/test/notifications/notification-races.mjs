import assert from 'node:assert/strict';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function blockedBy(source, pid) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const [{ waiting }] = await source.query(
      'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) AS waiting',
      [pid],
    );
    if (waiting) return;
    await delay(10);
  }
  throw new Error('Expected PostgreSQL lock waiter was not observed');
}

export async function verifyNotificationRaces(ctx) {
  const {
    source,
    actors,
    user,
    preferences,
    producer,
    inbox,
    record,
    workspace,
    board,
    card,
    count,
    pass,
  } = ctx;
  const racer = await user('racer'),
    second = await user('racer-second'),
    ws = ctx.persistenceWorkspace;
  await Promise.all([
    preferences.update(racer, { inApp: { cardAssigned: false } }),
    preferences.update(racer, { email: { dueReminder: true } }),
    preferences.update(racer, { inApp: { commentMentioned: false } }),
  ]);
  const pref = await preferences.get(racer);
  assert.equal(pref.inApp.cardAssigned, false);
  assert.equal(pref.inApp.commentMentioned, false);
  assert.equal(pref.email.dueReminder, true);
  assert.equal(pref.inApp.membershipChanged, true);
  await preferences.update(racer, {
    inApp: { cardAssigned: true, commentMentioned: true },
  });
  const duplicateKey = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      record('racer', 'MEMBERSHIP_CHANGED', { workspaceId: ws }, duplicateKey),
    ),
  );
  assert.equal(results.filter((row) => row.status === 'created').length, 1);
  assert.equal(new Set(results.map((row) => row.notificationId)).size, 1);
  const note = results[0].notificationId;
  const reads = await Promise.all(
    Array.from({ length: 8 }, () => inbox.read(racer, note)),
  );
  assert.equal(new Set(reads.map((row) => row.readAt)).size, 1);
  assert.equal(await count('racer'), 0);
  const inputs = [
    {
      recipientUserId: racer,
      actorUserId: second,
      kind: 'MEMBERSHIP_CHANGED',
      workspaceId: ws,
      occurrenceKey: randomUUID(),
    },
    {
      recipientUserId: second,
      actorUserId: racer,
      kind: 'MEMBERSHIP_CHANGED',
      workspaceId: ws,
      occurrenceKey: randomUUID(),
    },
  ];
  const [left, right] = await Promise.all([
    source.transaction((manager) => producer.recordMany(manager, inputs)),
    source.transaction((manager) =>
      producer.recordMany(
        manager,
        inputs
          .slice()
          .reverse()
          .map((row) => ({ ...row, occurrenceKey: randomUUID() })),
      ),
    ),
  ]);
  assert.equal(left.length + right.length, 4);
  assert.ok([...left, ...right].every((row) => row.status === 'created'));
  await inbox.readAll(racer);
  await inbox.readAll(second);
  pass(
    'serialized first-row and disjoint preference updates, concurrent dedupe and first-read, sorted multi-recipient locks with cross-actor foreign keys',
  );

  // Producer wins the parent lock: read-all waits, then sees and marks that row.
  const writer = source.createQueryRunner();
  await writer.connect();
  await writer.startTransaction();
  let all;
  try {
    const [{ pid }] = await writer.query('SELECT pg_backend_pid() AS pid');
    const created = await producer.record(writer.manager, {
      recipientUserId: racer,
      kind: 'MEMBERSHIP_CHANGED',
      workspaceId: ws,
      occurrenceKey: randomUUID(),
    });
    all = inbox.readAll(racer);
    await blockedBy(source, pid);
    await writer.commitTransaction();
    assert.equal((await all).updatedCount, 1);
    assert.notEqual(
      (
        await source
          .getRepository('UserNotification')
          .findOneByOrFail({ id: created.notificationId })
      ).readAt,
      null,
    );
  } finally {
    if (writer.isTransactionActive) await writer.rollbackTransaction();
    await writer.release();
    if (all) await Promise.allSettled([all]);
  }
  // Read-all wins: pause after its UPDATE until an incoming producer is visibly
  // blocked. The later row must remain unread once the first transaction commits.
  await record('racer', 'MEMBERSHIP_CHANGED', { workspaceId: ws });
  const original = source.createQueryRunner.bind(source),
    reached = deferred(),
    release = deferred();
  let readerPid,
    paused = false,
    readAll,
    incoming;
  source.createQueryRunner = (...args) => {
    const runner = original(...args),
      query = runner.query.bind(runner);
    runner.query = async (...queryArgs) => {
      const result = await query(...queryArgs);
      if (
        !paused &&
        String(queryArgs[0]).startsWith('UPDATE "user_notifications"')
      ) {
        paused = true;
        readerPid = (await query('SELECT pg_backend_pid() AS pid'))[0].pid;
        reached.resolve();
        await release.promise;
      }
      return result;
    };
    return runner;
  };
  try {
    readAll = inbox.readAll(racer);
    await reached.promise;
    incoming = record('racer', 'MEMBERSHIP_CHANGED', { workspaceId: ws });
    await blockedBy(source, readerPid);
    release.resolve();
    assert.equal((await readAll).updatedCount, 1);
    const created = await incoming;
    assert.equal(
      (
        await source
          .getRepository('UserNotification')
          .findOneByOrFail({ id: created.notificationId })
      ).readAt,
      null,
    );
    assert.equal(await count('racer'), 1);
  } finally {
    release.resolve();
    source.createQueryRunner = original;
    await Promise.allSettled([readAll, incoming].filter(Boolean));
  }
  pass(
    'observed PostgreSQL read-all versus incoming insert in both lock orders, preserving existing versus future unread semantics',
  );

  const parent = await board(
      await workspace('Atomic transaction'),
      'Atomic Board',
    ),
    resource = await card(parent, 'Original');
  const occurrenceKey = randomUUID();
  const mutate = async (manager, rollback) => {
    await manager.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [
      parent.id,
    ]);
    await manager.query(
      "UPDATE cards SET title='Committed together' WHERE id=$1",
      [resource],
    );
    const result = await producer.record(manager, {
      recipientUserId: racer,
      kind: 'CARD_ASSIGNED',
      cardId: resource,
      occurrenceKey,
    });
    if (rollback) throw new Error('synthetic domain rollback');
    return result;
  };
  await assert.rejects(
    source.transaction((manager) => mutate(manager, true)),
    /synthetic domain rollback/,
  );
  assert.equal(
    (await source.query('SELECT title FROM cards WHERE id=$1', [resource]))[0]
      .title,
    'Original',
  );
  assert.equal(
    await source
      .getRepository('UserNotification')
      .countBy({ dedupeKey: `CARD_ASSIGNED:card:${occurrenceKey}` }),
    0,
  );
  const committed = await source.transaction((manager) =>
    mutate(manager, false),
  );
  assert.equal(committed.status, 'created');
  assert.equal(
    (await source.query('SELECT title FROM cards WHERE id=$1', [resource]))[0]
      .title,
    'Committed together',
  );
  const duplicate = await source.transaction((manager) =>
    producer.record(manager, {
      recipientUserId: racer,
      kind: 'CARD_ASSIGNED',
      cardId: resource,
      occurrenceKey,
    }),
  );
  assert.equal(duplicate.status, 'duplicate');
  pass(
    'synthetic business row and notification commit/rollback atomically, stable occurrence replay leaves domain success intact',
  );

  const scale = await user('scale');
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')`,
    [parent.id, scale],
  );
  await source.query(
    `INSERT INTO user_notifications(recipient_user_id,kind,dedupe_key,actor_user_id,board_id,card_id,created_at)
    SELECT $1,'CARD_ASSIGNED','CARD_ASSIGNED:card:scale-'||n,$2,$3,$4,'2026-01-01T00:00:00Z' FROM generate_series(1,1200) n`,
    [scale, actors.owner, parent.id, resource],
  );
  await source.query('ANALYZE user_notifications');
  const capture = async (callback) => {
    const queries = [];
    source.createQueryRunner = (...args) => {
      const runner = original(...args),
        query = runner.query.bind(runner);
      runner.query = async (...queryArgs) => {
        queries.push({ sql: queryArgs[0], params: queryArgs[1] });
        return query(...queryArgs);
      };
      return runner;
    };
    try {
      return { result: await callback(), queries };
    } finally {
      source.createQueryRunner = original;
    }
  };
  const one = await capture(() =>
      inbox.list(scale, { page: 1, limit: 1, filter: 'unread' }),
    ),
    many = await capture(() =>
      inbox.list(scale, { page: 12, limit: 100, filter: 'unread' }),
    );
  assert.equal(many.result.data.length, 100);
  assert.equal(many.result.meta.total, 1200);
  assert.equal(many.result.meta.totalPages, 12);
  assert.ok(many.result.data.every((row) => !row.isUnavailable));
  const selects = (rows) => rows.filter((row) => /^\s*SELECT\b/.test(row.sql));
  assert.equal(selects(one.queries).length, selects(many.queries).length);
  assert.equal(selects(many.queries).length, 5);
  const expected = (
    await source.query(
      'SELECT id FROM user_notifications WHERE recipient_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET 1100',
      [scale],
    )
  ).map((row) => row.id);
  assert.deepEqual(
    many.result.data.map((row) => row.id),
    expected,
  );
  const page = selects(many.queries).find((row) =>
    row.sql.includes('ORDER BY'),
  );
  const [explained] = await source.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${page.sql}`,
    page.params,
  );
  const plan = explained['QUERY PLAN'][0];
  assert.ok(plan['Execution Time'] < 10000);
  console.log(
    `Notification query sanity: 1,200 rows; inbox 5 SELECTs for 1 or 100 Card-context items; EXPLAIN page ${plan['Execution Time']}ms`,
  );
  pass(
    'large tied inbox, SQL pagination and indexed plan, bounded batch context/actor resolution with constant query count',
  );
}
