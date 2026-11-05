import assert from 'node:assert/strict';
import console from 'node:console';
import { setTimeout as delay } from 'node:timers/promises';

async function waitFor(check) {
  for (let i = 0; i < 300; i++) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error('Expected database race boundary was not reached');
}

/** Real PostgreSQL races; expiry is forced in SQL instead of waiting two minutes. */
export async function verifyTaskStabilization({
  source,
  TaskEmailDispatcher,
  scanner,
}) {
  const [user] =
    await source.query(`INSERT INTO users(email,display_name,email_verified_at)
    VALUES ('stab01@example.test','Stabilization',now()) RETURNING id`);
  const [workspace] = await source.query(
    `INSERT INTO workspaces(type,name,created_by_id)
    VALUES ('TEAM','Stabilization',$1) RETURNING id`,
    [user.id],
  );
  const [board] = await source.query(
    `INSERT INTO boards(name,workspace_id,created_by_id)
    VALUES ('Stabilization',$1,$2) RETURNING id`,
    [workspace.id, user.id],
  );
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')`,
    [board.id, user.id],
  );
  const [column] = await source.query(
    `INSERT INTO board_columns(board_id,name,position) VALUES ($1,'Todo',100) RETURNING id`,
    [board.id],
  );
  const [card] = await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position,due_date)
    VALUES ($1,$2,$3,'Task',100,now()+interval '60 hours') RETURNING id`,
    [board.id, column.id, user.id],
  );
  await source.query(
    'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
    [card.id, user.id],
  );
  await source.query(
    `INSERT INTO notification_preferences(user_id,email_card_assigned,email_due_reminder) VALUES ($1,true,true)`,
    [user.id],
  );
  const row = async (id) =>
    (
      await source.query(
        'SELECT * FROM task_notification_email_outbox WHERE id=$1',
        [id],
      )
    )[0];
  let sequence = 0;
  const create = async (count = 1) =>
    source.query(
      `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id,next_attempt_at)
    SELECT $1,'CARD_ASSIGNED',$4 || '-' || n,$2,$3,'2000-01-01'::timestamptz+n*interval '1 second'
    FROM generate_series(1,$5::int) n RETURNING *`,
      [user.id, board.id, card.id, `stab-${++sequence}`, count],
    );
  const clean = () =>
    source.query(
      'DELETE FROM task_notification_email_outbox WHERE recipient_user_id=$1',
      [user.id],
    );
  const expire = () =>
    source.query(
      `UPDATE task_notification_email_outbox SET lease_until=clock_timestamp()-interval '1 second'
    WHERE recipient_user_id=$1 AND status='PROCESSING'`,
      [user.id],
    );

  // The first provider attempt stalls past every batch lease. No transaction or
  // Board/recipient lock may be held during that provider call.
  for (const competing of [false, true]) {
    const jobs = await create(3);
    const ids = new Set(jobs.map((job) => job.id));
    const calls = [];
    let first = true;
    const mailer = {
      send: async (message) => {
        calls.push(message.outboxId);
        if (first) {
          first = false;
          await source.transaction(async (manager) => {
            await manager.query(
              'SELECT id FROM boards WHERE id=$1 FOR UPDATE NOWAIT',
              [board.id],
            );
            await manager.query(
              'SELECT id FROM users WHERE id=$1 FOR UPDATE NOWAIT',
              [user.id],
            );
            await manager.query(
              'SELECT id FROM task_notification_email_outbox WHERE id=$1 FOR UPDATE NOWAIT',
              [message.outboxId],
            );
          });
          await expire();
          if (competing)
            await new TaskEmailDispatcher(source, {
              send: async (other) => {
                calls.push(other.outboxId);
                return 'SENT';
              },
            }).drain(3);
        }
        return 'SENT';
      },
    };
    await new TaskEmailDispatcher(source, mailer).drain(3);
    assert.equal(calls.filter((id) => ids.has(id)).length, 3);
    for (const job of jobs) {
      assert.equal(calls.filter((id) => id === job.id).length, 1);
      const state = await row(job.id);
      assert.equal(state.attempts, 1);
      assert.ok(
        ['SENT', ...(competing ? ['UNKNOWN'] : [])].includes(state.status),
      );
    }
    if (competing)
      assert.equal(
        (await Promise.all(jobs.map((job) => row(job.id)))).filter(
          (job) => job.status === 'UNKNOWN',
        ).length,
        1,
      );
    await clean();
  }
  console.log(
    'PASS: expired sequential batches renew unsent jobs; competing workers never repeat an attempted send',
  );

  // Expiry while waiting for a domain lock, with and without a competing claim.
  for (const takeover of [false, true]) {
    const [job] = await create();
    const calls = [];
    const mailer = {
      send: async (message) => {
        calls.push(message.outboxId);
        return 'SENT';
      },
    };
    const dispatcher = new TaskEmailDispatcher(source, mailer);
    await source.query(
      `UPDATE task_notification_email_outbox SET status='PROCESSING',lease_owner=$2,lease_until=now()+interval '2 minutes' WHERE id=$1`,
      [job.id, dispatcher.owner],
    );
    const lock = source.createQueryRunner();
    await lock.connect();
    await lock.startTransaction();
    let sending, competing;
    try {
      const [{ pid }] = await lock.query('SELECT pg_backend_pid() AS pid');
      await lock.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [
        board.id,
      ]);
      sending = dispatcher.send(job);
      await waitFor(
        async () =>
          (
            await source.query(
              'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting',
              [pid],
            )
          )[0].waiting,
      );
      await expire();
      if (takeover) {
        const second = new TaskEmailDispatcher(source, mailer);
        competing = second.drain(1);
        await waitFor(
          async () => (await row(job.id)).lease_owner === second.owner,
        );
      }
      await lock.commitTransaction();
      await Promise.all([sending, competing]);
      assert.deepEqual(calls, [job.id]);
      assert.equal((await row(job.id)).status, 'SENT');
    } finally {
      if (lock.isTransactionActive) await lock.rollbackTransaction();
      await lock.release();
      await Promise.allSettled([sending, competing]);
    }
    await clean();
  }
  console.log(
    'PASS: lock-delayed expired jobs renew only while still owned, including takeover races',
  );

  for (const attempted of [false, true]) {
    const [job] = await create();
    let sends = 0;
    const dispatcher = new TaskEmailDispatcher(source, {
      send: async () => {
        sends++;
        return 'SENT';
      },
    });
    await source.query(
      `UPDATE task_notification_email_outbox SET status='PROCESSING',lease_owner=$2,lease_until=now()-interval '1 second',
      first_attempt_at=CASE WHEN $3 THEN now() ELSE NULL END, attempts=CASE WHEN $3 THEN 1 ELSE 0 END WHERE id=$1`,
      [job.id, dispatcher.owner, attempted],
    );
    await dispatcher.send(job);
    assert.equal((await row(job.id)).status, attempted ? 'UNKNOWN' : 'SENT');
    assert.equal(sends, attempted ? 0 : 1);
    await clean();
  }

  // A decision can itself outlive a renewed lease. Exercise the final attempt
  // fence with real SQL, after eligibility and immediately before recording an attempt.
  for (const attempted of [false, true]) {
    const [job] = await create();
    if (attempted)
      await source.query(
        `UPDATE task_notification_email_outbox SET first_attempt_at=now(),last_attempt_at=now(),attempts=1 WHERE id=$1`,
        [job.id],
      );
    const delayed = {
      query: source.query.bind(source),
      transaction: (work) =>
        source.transaction((manager) =>
          work({
            query: async (sql, parameters) => {
              const result = await manager.query(sql, parameters);
              if (
                sql.includes(
                  'SELECT count(*) AS count FROM task_notification_email_outbox',
                )
              )
                await manager.query(
                  `UPDATE task_notification_email_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`,
                  [job.id],
                );
              return result;
            },
          }),
        ),
    };
    let sends = 0;
    await new TaskEmailDispatcher(delayed, {
      send: async () => {
        sends++;
        return 'SENT';
      },
    }).drain(1);
    assert.equal(sends, 0);
    assert.equal((await row(job.id)).status, attempted ? 'UNKNOWN' : 'PENDING');
    assert.equal((await row(job.id)).attempts, attempted ? 1 : 0);
    await clean();
  }
  console.log(
    'PASS: expiry before/after an attempt preserves PENDING/UNKNOWN without a duplicate provider call',
  );

  const [ineligible] = await create();
  const dispatcher = new TaskEmailDispatcher(source, {
    send: async () => {
      throw new Error('Ineligible job must not send');
    },
  });
  await source.query(
    `UPDATE task_notification_email_outbox SET status='PROCESSING',lease_owner=$2,lease_until=now()-interval '1 second' WHERE id=$1`,
    [ineligible.id, dispatcher.owner],
  );
  await source.query(
    'UPDATE notification_preferences SET email_card_assigned=false WHERE user_id=$1',
    [user.id],
  );
  await dispatcher.send(ineligible);
  assert.equal((await row(ineligible.id)).status, 'CANCELLED');
  await clean();

  // A future candidate must not wait behind a Board lock. Once eligible, two
  // independent scans must still create exactly one notification and email intent.
  const lock = source.createQueryRunner();
  await lock.connect();
  await lock.startTransaction();
  let scanning;
  try {
    await lock.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [
      board.id,
    ]);
    scanning = scanner().scan(500);
    await Promise.race([
      scanning,
      delay(3000).then(() => {
        throw new Error('Future candidate took a Board lock');
      }),
    ]);
  } finally {
    if (lock.isTransactionActive) await lock.rollbackTransaction();
    await lock.release();
    if (scanning) await scanning;
  }
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM user_notifications WHERE recipient_user_id=$1',
        [user.id],
      )
    )[0].n,
    0,
  );
  await source.query(
    `UPDATE cards SET due_date=now()+interval '1 hour' WHERE id=$1`,
    [card.id],
  );
  await Promise.all([scanner().scan(500), scanner().scan(500)]);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM user_notifications WHERE recipient_user_id=$1',
        [user.id],
      )
    )[0].n,
    1,
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM task_notification_email_outbox WHERE recipient_user_id=$1',
        [user.id],
      )
    )[0].n,
    1,
  );
  await clean();
  await source.query('DELETE FROM boards WHERE id=$1', [board.id]);
  await source.query('DELETE FROM workspaces WHERE id=$1', [workspace.id]);
  await source.query(
    'DELETE FROM user_notifications WHERE recipient_user_id=$1',
    [user.id],
  );
  await source.query('DELETE FROM notification_preferences WHERE user_id=$1', [
    user.id,
  ]);
  await source.query('DELETE FROM users WHERE id=$1', [user.id]);
  console.log(
    'PASS: future reminders avoid Board locks; concurrent eligible scans still deduplicate records and email intents',
  );
}
