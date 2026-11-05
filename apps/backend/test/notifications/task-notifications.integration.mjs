import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyTaskStabilization } from './task-stabilization-checks.mjs';

assert.equal(process.env.NOTIFICATION_DATABASE_TESTS, 'local-only');
assert.ok(
  ['127.0.0.1', 'localhost', '::1'].includes(process.env.DATABASE_HOST),
);
assert.notEqual(process.env.NODE_ENV, 'production');
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { databaseOptions } = require('../../dist/database/database-options.js');
const {
  NotificationService,
} = require('../../dist/api/notifications/notification.service.js');
const {
  UserNotification,
} = require('../../dist/api/notifications/entities/user-notification.entity.js');
const {
  DueReminderScanner,
} = require('../../dist/api/notifications/due-reminder-scanner.service.js');
const {
  TaskEmailDispatcher,
} = require('../../dist/api/notifications/task-email-dispatcher.service.js');
const {
  enqueueTaskEmail,
} = require('../../dist/api/notifications/task-email-outbox.js');
const {
  FakeTaskNotificationMailer,
  TaskNotificationMailer,
  taskNotificationContent,
} = require('../../dist/mail/task-notification-mailer.js');
const options = databaseOptions(process.env);
const name = `kanban_p405_${randomBytes(8).toString('hex')}`;
const admin = new Client({ ...options, user: options.username });
let source,
  app,
  created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  source = await new DataSource({ ...options, database: name }).initialize();
  const migrations = source.migrations;
  source.migrations = migrations.filter(
    (migration) =>
      !migration.name.startsWith('TaskNotificationEmailOutbox') &&
      !migration.name.startsWith('AccountDeletion'),
  );
  await source.runMigrations();
  const [user] = await source.query(
    `INSERT INTO users(email, display_name, email_verified_at) VALUES ('p405@example.test', 'Test', now()) RETURNING id`,
  );
  const [board] = await source.query(
    `INSERT INTO boards(name,created_by_id) VALUES ('Board',$1) RETURNING id`,
    [user.id],
  );
  await source.query(
    `INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')`,
    [board.id, user.id],
  );
  const [column] = await source.query(
    `INSERT INTO board_columns(board_id,name,position) VALUES ($1,'Column',100) RETURNING id`,
    [board.id],
  );
  const [card] = await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position,due_date) VALUES ($1,$2,$3,'Private text',100,now()+interval '1 hour') RETURNING id`,
    [board.id, column.id, user.id],
  );
  await source.query(
    'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
    [card.id, user.id],
  );
  await source.query(
    `INSERT INTO notification_preferences(user_id,in_app_due_reminder,email_due_reminder) VALUES ($1,false,true)`,
    [user.id],
  );
  const snapshot = async () =>
    Promise.all(
      [
        'users',
        'boards',
        'board_members',
        'board_columns',
        'cards',
        'card_assignees',
        'notification_preferences',
      ].map((table) =>
        source.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY 1`),
      ),
    );
  const beforeUpgrade = await snapshot();
  source.migrations = migrations;
  assert.equal((await source.runMigrations()).length, 2);
  assert.deepEqual(await snapshot(), beforeUpgrade);
  assert.deepEqual(await source.runMigrations(), []);
  const indices = await source.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='task_notification_email_outbox'",
  );
  const indexNames = indices.map((row) => row.indexname);
  for (const name of [
    'IDX_task_email_ready',
    'IDX_task_email_expired_lease',
    'IDX_task_email_pending_age',
    'IDX_task_email_recipient_sent',
    'IDX_task_email_recipient_attempt',
  ])
    assert.ok(indexNames.includes(name));
  const plan = await source.transaction(async (manager) => {
    await manager.query('SET LOCAL enable_seqscan=off');
    return manager.query(`EXPLAIN SELECT id FROM cards WHERE due_date > now()
      AND due_date <= now()+interval '72 hours' AND NOT is_archived
      ORDER BY due_date,id LIMIT 50`);
  });
  assert.match(
    plan.map((line) => line['QUERY PLAN']).join('\n'),
    /IDX_cards_due_scan/,
  );
  console.log('PASS: populated P4-05 forward upgrade preserves existing data');
  const service = new NotificationService(
    source.getRepository(UserNotification),
  );
  const hints = [];
  const scanner = () =>
    new DueReminderScanner(source, service, {
      afterCommit: async (ids) => hints.push(...ids),
    });
  await Promise.all([scanner().scan(50), scanner().scan(50)]);
  assert.equal(
    (await source.query('SELECT count(*)::int AS n FROM user_notifications'))[0]
      .n,
    0,
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM task_notification_email_outbox',
      )
    )[0].n,
    1,
  );
  assert.deepEqual(hints, []);
  await source.query(
    `UPDATE cards SET due_date=CASE
    WHEN (due_date AT TIME ZONE 'UTC')::date=((due_date+interval '5 seconds') AT TIME ZONE 'UTC')::date
    THEN due_date+interval '5 seconds' ELSE due_date-interval '5 seconds' END WHERE id=$1`,
    [card.id],
  );
  await scanner().scan(50);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM task_notification_email_outbox',
      )
    )[0].n,
    1,
  );
  const fake = new FakeTaskNotificationMailer();
  await new TaskEmailDispatcher(source, fake).drain(50);
  assert.equal(fake.deliveries.length, 1);
  assert.equal(fake.deliveries[0].kind, 'DUE_REMINDER');
  assert.equal(
    taskNotificationContent(fake.deliveries[0], 'https://kanvexa.example')
      .subject,
    'A task deadline is approaching on Kanvexa',
  );
  await source.query(
    'UPDATE notification_preferences SET email_card_assigned=true, email_comment_mentioned=true WHERE user_id=$1',
    [user.id],
  );
  const mappingMailer = new FakeTaskNotificationMailer();
  for (const [kind, subject] of [
    ['CARD_ASSIGNED', "You've been assigned to a card on Kanvexa"],
    ['COMMENT_MENTIONED', 'Someone mentioned you on Kanvexa'],
  ]) {
    const [queued] = await source.query(
      `INSERT INTO task_notification_email_outbox
       (recipient_user_id,kind,occurrence_key,board_id,card_id)
       VALUES ($1,$2,$2,$3,$4) RETURNING id`,
      [user.id, kind, board.id, card.id],
    );
    await new TaskEmailDispatcher(source, mappingMailer).drain(50);
    const delivery = mappingMailer.deliveries.find(
      (message) => message.outboxId === queued.id,
    );
    assert.ok(delivery);
    assert.equal(delivery.kind, kind);
    assert.equal(
      taskNotificationContent(delivery, 'https://kanvexa.example').subject,
      subject,
    );
    await source.query(
      'DELETE FROM task_notification_email_outbox WHERE id=$1',
      [queued.id],
    );
  }
  await source.query(
    'UPDATE notification_preferences SET email_card_assigned=false, email_comment_mentioned=false WHERE user_id=$1',
    [user.id],
  );
  console.log(
    'PASS: persisted task email kinds reach the correct renderer variants',
  );
  await source.query(
    'UPDATE notification_preferences SET email_card_assigned=true WHERE user_id=$1',
    [user.id],
  );
  const fencedMailer = new FakeTaskNotificationMailer();
  const fencedDispatcher = new TaskEmailDispatcher(source, fencedMailer);
  const [fenced] = await source.query(
    `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id,status,lease_owner,lease_until)
    VALUES ($1,'CARD_ASSIGNED','fenced',$2,$3,'PROCESSING',$4,now()+interval '1 minute') RETURNING id`,
    [user.id, board.id, card.id, fencedDispatcher.owner],
  );
  const fenceRunner = source.createQueryRunner();
  await fenceRunner.connect();
  await fenceRunner.startTransaction();
  try {
    await fenceRunner.query(
      "UPDATE task_notification_email_outbox SET status='CANCELLED',lease_owner=NULL,lease_until=NULL WHERE id=$1",
      [fenced.id],
    );
    const sending = fencedDispatcher.send({
      id: fenced.id,
      recipient_user_id: user.id,
      board_id: board.id,
      card_id: card.id,
      kind: 'CARD_ASSIGNED',
      attempts: 0,
    });
    let waiting = false;
    for (let i = 0; i < 200 && !waiting; i++) {
      const [state] =
        await source.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%UPDATE task_notification_email_outbox SET lease_until%') AS waiting`);
      waiting = state.waiting;
      if (!waiting) await delay(50);
    }
    assert.equal(waiting, true);
    await fenceRunner.commitTransaction();
    await sending;
  } finally {
    if (fenceRunner.isTransactionActive)
      await fenceRunner.rollbackTransaction();
    await fenceRunner.release();
  }
  assert.equal(fencedMailer.deliveries.length, 0);
  await source.query('DELETE FROM task_notification_email_outbox WHERE id=$1', [
    fenced.id,
  ]);
  const [expiring] = await source.query(
    `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id,created_at)
    VALUES ($1,'CARD_ASSIGNED','expires-while-waiting',$2,$3,clock_timestamp()-interval '23 hours 59 minutes 50 seconds') RETURNING id`,
    [user.id, board.id, card.id],
  );
  const userLock = source.createQueryRunner();
  await userLock.connect();
  await userLock.startTransaction();
  try {
    await userLock.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [
      user.id,
    ]);
    const draining = new TaskEmailDispatcher(source, fencedMailer).drain(50);
    let blocked = false;
    for (let i = 0; i < 200 && !blocked; i++) {
      const [state] =
        await source.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM users%') AS blocked`);
      blocked = state.blocked;
      if (!blocked) await delay(50);
    }
    assert.equal(blocked, true);
    await source.query(
      "UPDATE task_notification_email_outbox SET created_at=clock_timestamp()-interval '24 hours'+interval '1 second' WHERE id=$1",
      [expiring.id],
    );
    await delay(1500);
    await userLock.commitTransaction();
    await draining;
  } finally {
    if (userLock.isTransactionActive) await userLock.rollbackTransaction();
    await userLock.release();
  }
  assert.equal(
    (
      await source.query(
        'SELECT status FROM task_notification_email_outbox WHERE id=$1',
        [expiring.id],
      )
    )[0].status,
    'CANCELLED',
  );
  assert.equal(fencedMailer.deliveries.length, 0);
  await source.query('DELETE FROM task_notification_email_outbox WHERE id=$1', [
    expiring.id,
  ]);
  const [grantRace] = await source.query(
    `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id)
    VALUES ($1,'CARD_ASSIGNED','dispatch-revocation-race',$2,$3) RETURNING id`,
    [user.id, board.id, card.id],
  );
  const boardLock = source.createQueryRunner();
  await boardLock.connect();
  await boardLock.startTransaction();
  try {
    await boardLock.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [
      board.id,
    ]);
    await boardLock.query(
      'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
      [board.id, user.id],
    );
    const draining = new TaskEmailDispatcher(source, fencedMailer).drain(50);
    let blocked = false;
    for (let i = 0; i < 200 && !blocked; i++) {
      const [state] =
        await source.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM boards%') AS blocked`);
      blocked = state.blocked;
      if (!blocked) await delay(50);
    }
    assert.equal(blocked, true);
    await boardLock.commitTransaction();
    await draining;
  } finally {
    if (boardLock.isTransactionActive) await boardLock.rollbackTransaction();
    await boardLock.release();
  }
  assert.equal(
    (
      await source.query(
        'SELECT status FROM task_notification_email_outbox WHERE id=$1',
        [grantRace.id],
      )
    )[0].status,
    'CANCELLED',
  );
  assert.equal(fencedMailer.deliveries.length, 0);
  await source.query('DELETE FROM task_notification_email_outbox WHERE id=$1', [
    grantRace.id,
  ]);
  await source.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')",
    [board.id, user.id],
  );
  const stopping = new TaskEmailDispatcher(source, fencedMailer);
  await source.query(
    `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id,status,lease_owner,lease_until,first_attempt_at,last_attempt_at)
    VALUES ($1,'CARD_ASSIGNED','shutdown-unattempted',$2,$3,'PROCESSING',$4,now()+interval '1 minute',NULL,NULL),
           ($1,'CARD_ASSIGNED','shutdown-attempted',$2,$3,'PROCESSING',$4,now()+interval '1 minute',now(),now())`,
    [user.id, board.id, card.id, stopping.owner],
  );
  await stopping.releaseOwned();
  assert.deepEqual(
    await source.query(
      "SELECT occurrence_key,status,lease_owner FROM task_notification_email_outbox WHERE occurrence_key LIKE 'shutdown-%' ORDER BY occurrence_key",
    ),
    [
      {
        occurrence_key: 'shutdown-attempted',
        status: 'UNKNOWN',
        lease_owner: null,
      },
      {
        occurrence_key: 'shutdown-unattempted',
        status: 'PENDING',
        lease_owner: null,
      },
    ],
  );
  await source.query(
    "DELETE FROM task_notification_email_outbox WHERE occurrence_key LIKE 'shutdown-%'",
  );
  await source.query(
    'UPDATE notification_preferences SET email_card_assigned=false WHERE user_id=$1',
    [user.id],
  );
  assert.equal(
    (await source.query('SELECT status FROM task_notification_email_outbox'))[0]
      .status,
    'SENT',
  );
  await scanner().scan(50);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM task_notification_email_outbox',
      )
    )[0].n,
    1,
  );
  await source.query(
    'UPDATE notification_preferences SET in_app_due_reminder=true, email_due_reminder=false WHERE user_id=$1',
    [user.id],
  );
  await scanner().scan(50);
  assert.equal(
    (await source.query('SELECT count(*)::int AS n FROM user_notifications'))[0]
      .n,
    1,
  );
  assert.deepEqual(hints, [user.id]);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM task_notification_email_outbox',
      )
    )[0].n,
    1,
  );
  await source.query(
    'UPDATE notification_preferences SET in_app_due_reminder=false, email_due_reminder=true WHERE user_id=$1',
    [user.id],
  );
  console.log(
    'PASS: full migration, concurrent due dedupe, independent opt-in, fake delivery and replay',
  );
  const zoneForHour = (hour) => {
    let offset = hour - new Date().getUTCHours();
    if (offset < -12) offset += 24;
    if (offset > 14) offset -= 24;
    return offset === 0
      ? 'UTC'
      : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
  };
  const zone = zoneForHour(10);
  await source.query(
    'INSERT INTO user_preferences(user_id,time_zone) VALUES ($1,$2)',
    [user.id, zone],
  );
  await source.query(
    'UPDATE notification_preferences SET in_app_due_reminder=true WHERE user_id=$1',
    [user.id],
  );
  const [dateCard] = await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position,due_date)
    VALUES ($1,$2,$3,'Date changes',150,now()+interval '1 hour') RETURNING id`,
    [board.id, column.id, user.id],
  );
  await source.query(
    'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
    [dateCard.id, user.id],
  );
  await scanner().scan(50);
  await source.query(
    "UPDATE cards SET due_date=now()+interval '25 hours' WHERE id=$1",
    [dateCard.id],
  );
  await scanner().scan(50);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM user_notifications WHERE card_id=$1',
        [dateCard.id],
      )
    )[0].n,
    2,
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM task_notification_email_outbox WHERE card_id=$1',
        [dateCard.id],
      )
    )[0].n,
    2,
  );
  await source.query(
    'DELETE FROM task_notification_email_outbox WHERE card_id=$1',
    [dateCard.id],
  );
  await source.query('DELETE FROM user_notifications WHERE card_id=$1', [
    dateCard.id,
  ]);
  await source.query('DELETE FROM cards WHERE id=$1', [dateCard.id]);
  await source.query(
    'UPDATE user_preferences SET time_zone=$2 WHERE user_id=$1',
    [user.id, zoneForHour(8)],
  );
  const [earlyCard] = await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position,due_date)
    VALUES ($1,$2,$3,'Early task',150,now()+interval '25 hours') RETURNING id`,
    [board.id, column.id, user.id],
  );
  await source.query(
    'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
    [earlyCard.id, user.id],
  );
  await scanner().scan(50);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM task_notification_email_outbox WHERE card_id=$1',
        [earlyCard.id],
      )
    )[0].n,
    0,
  );
  await source.query(
    'UPDATE user_preferences SET time_zone=$2 WHERE user_id=$1',
    [user.id, zone],
  );
  await scanner().scan(50);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM task_notification_email_outbox WHERE card_id=$1',
        [earlyCard.id],
      )
    )[0].n,
    1,
  );
  await source.query(
    'DELETE FROM task_notification_email_outbox WHERE card_id=$1',
    [earlyCard.id],
  );
  await source.query('DELETE FROM user_notifications WHERE card_id=$1', [
    earlyCard.id,
  ]);
  await source.query('DELETE FROM cards WHERE id=$1', [earlyCard.id]);
  await source.query('DELETE FROM user_preferences WHERE user_id=$1', [
    user.id,
  ]);
  const pagedCards = await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position,due_date)
    SELECT $1,$2,$3,'Paged task',n,now()+interval '1 hour' FROM unnest(ARRAY[160,170,180]) n RETURNING id`,
    [board.id, column.id, user.id],
  );
  for (const item of pagedCards)
    await source.query(
      'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
      [item.id, user.id],
    );
  const pagedScanner = scanner();
  for (let i = 0; i < 10; i++) await pagedScanner.scan(1);
  const pageIds = pagedCards.map((item) => item.id);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM task_notification_email_outbox WHERE card_id=ANY($1::uuid[])',
        [pageIds],
      )
    )[0].n,
    3,
  );
  await source.query(
    'DELETE FROM task_notification_email_outbox WHERE card_id=ANY($1::uuid[])',
    [pageIds],
  );
  await source.query(
    'DELETE FROM user_notifications WHERE card_id=ANY($1::uuid[])',
    [pageIds],
  );
  await source.query('DELETE FROM cards WHERE id=ANY($1::uuid[])', [pageIds]);
  await source.query(
    'UPDATE notification_preferences SET in_app_due_reminder=false WHERE user_id=$1',
    [user.id],
  );
  const [overdue] = await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position,due_date)
    VALUES ($1,$2,$3,'Overdue task',150,now()-interval '1 second') RETURNING id`,
    [board.id, column.id, user.id],
  );
  await source.query(
    'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
    [overdue.id, user.id],
  );
  await scanner().scan(50);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM task_notification_email_outbox WHERE card_id=$1',
        [overdue.id],
      )
    )[0].n,
    0,
  );
  await source.query('DELETE FROM cards WHERE id=$1', [overdue.id]);
  console.log(
    'PASS: local date edits, early schedule, timezone catch-up and overdue suppression',
  );
  const insert = async (key) =>
    source.query(
      `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id)
    VALUES ($1,'DUE_REMINDER',$2,$3,$4) RETURNING id`,
      [user.id, key, board.id, card.id],
    );
  const [optedOut] = await insert('opted-out');
  await source.query(
    'UPDATE notification_preferences SET email_due_reminder=false WHERE user_id=$1',
    [user.id],
  );
  await new TaskEmailDispatcher(source, fake).drain(50);
  assert.equal(
    (
      await source.query(
        'SELECT status FROM task_notification_email_outbox WHERE id=$1',
        [optedOut.id],
      )
    )[0].status,
    'CANCELLED',
  );
  await source.query(
    'UPDATE notification_preferences SET email_due_reminder=true WHERE user_id=$1',
    [user.id],
  );
  await source.query(
    'UPDATE notification_preferences SET email_card_assigned=true WHERE user_id=$1',
    [user.id],
  );
  await assert.rejects(
    source.transaction(async (manager) => {
      await enqueueTaskEmail(manager, {
        recipientUserId: user.id,
        kind: 'CARD_ASSIGNED',
        occurrenceKey: 'rollback',
        boardId: board.id,
        cardId: card.id,
      });
      throw new Error('rollback');
    }),
    /rollback/,
  );
  assert.equal(
    (
      await source.query(
        "SELECT count(*)::int AS n FROM task_notification_email_outbox WHERE occurrence_key='rollback'",
      )
    )[0].n,
    0,
  );
  const [unverified] = await source.query(
    `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id)
    VALUES ($1,'CARD_ASSIGNED','unverified',$2,$3) RETURNING id`,
    [user.id, board.id, card.id],
  );
  await source.query('UPDATE users SET email_verified_at=NULL WHERE id=$1', [
    user.id,
  ]);
  await source.transaction(async (manager) => {
    await manager.query('SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE', [
      user.id,
    ]);
    await enqueueTaskEmail(manager, {
      recipientUserId: user.id,
      kind: 'CARD_ASSIGNED',
      occurrenceKey: 'unverified-enqueue',
      boardId: board.id,
      cardId: card.id,
    });
  });
  assert.equal(
    (
      await source.query(
        "SELECT count(*)::int AS n FROM task_notification_email_outbox WHERE occurrence_key='unverified-enqueue'",
      )
    )[0].n,
    0,
  );
  await new TaskEmailDispatcher(source, fake).drain(50);
  assert.equal(
    (
      await source.query(
        'SELECT status FROM task_notification_email_outbox WHERE id=$1',
        [unverified.id],
      )
    )[0].status,
    'CANCELLED',
  );
  await source.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [
    user.id,
  ]);
  const [ambiguous] = await source.query(
    `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id)
    VALUES ($1,'CARD_ASSIGNED','ambiguous',$2,$3) RETURNING id`,
    [user.id, board.id, card.id],
  );
  await new TaskEmailDispatcher(source, { send: async () => 'UNKNOWN' }).drain(
    50,
  );
  assert.equal(
    (
      await source.query(
        'SELECT status FROM task_notification_email_outbox WHERE id=$1',
        [ambiguous.id],
      )
    )[0].status,
    'UNKNOWN',
  );
  await new TaskEmailDispatcher(source, fake).drain(50);
  assert.equal(fake.deliveries.length, 1);
  const [expiredLease] = await source.query(
    `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id,status,lease_owner,lease_until)
    VALUES ($1,'CARD_ASSIGNED','expired-lease',$2,$3,'PROCESSING',gen_random_uuid(),now()-interval '1 minute') RETURNING id`,
    [user.id, board.id, card.id],
  );
  const [uncertainLease] = await source.query(
    `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id,status,lease_owner,lease_until,first_attempt_at,last_attempt_at,attempts)
    VALUES ($1,'CARD_ASSIGNED','uncertain-lease',$2,$3,'PROCESSING',gen_random_uuid(),now()-interval '1 minute',now()-interval '2 minutes',now()-interval '2 minutes',1) RETURNING id`,
    [user.id, board.id, card.id],
  );
  const recoveryMailer = new FakeTaskNotificationMailer();
  await new TaskEmailDispatcher(source, recoveryMailer).drain(50);
  assert.equal(recoveryMailer.deliveries.length, 1);
  assert.equal(
    (
      await source.query(
        'SELECT status FROM task_notification_email_outbox WHERE id=$1',
        [uncertainLease.id],
      )
    )[0].status,
    'UNKNOWN',
  );
  await source.query(
    "UPDATE task_notification_email_outbox SET first_attempt_at=now()-interval '25 hours' WHERE id=$1",
    [uncertainLease.id],
  );
  assert.equal(
    (
      await source.query(
        'SELECT status FROM task_notification_email_outbox WHERE id=$1',
        [expiredLease.id],
      )
    )[0].status,
    'SENT',
  );
  await source.query(
    `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id)
    SELECT $1,'CARD_ASSIGNED','concurrent-' || n,$2,$3 FROM generate_series(1,2) AS n`,
    [user.id, board.id, card.id],
  );
  const concurrentMailer = new FakeTaskNotificationMailer();
  await Promise.all([
    new TaskEmailDispatcher(source, concurrentMailer).drain(50),
    new TaskEmailDispatcher(source, concurrentMailer).drain(50),
  ]);
  assert.equal(concurrentMailer.deliveries.length, 2);
  const [retry] = await source.query(
    `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id)
    VALUES ($1,'CARD_ASSIGNED','retry',$2,$3) RETURNING id`,
    [user.id, board.id, card.id],
  );
  await new TaskEmailDispatcher(source, { send: async () => 'RETRY' }).drain(
    50,
  );
  const [deferred] = await source.query(
    `SELECT status,attempts,next_attempt_at > now() AS deferred
    FROM task_notification_email_outbox WHERE id=$1`,
    [retry.id],
  );
  assert.deepEqual(deferred, {
    status: 'PENDING',
    attempts: 1,
    deferred: true,
  });
  await source.query(
    'UPDATE task_notification_email_outbox SET next_attempt_at=now() WHERE id=$1',
    [retry.id],
  );
  await new TaskEmailDispatcher(source, recoveryMailer).drain(50);
  assert.deepEqual(
    (
      await source.query(
        'SELECT status,attempts FROM task_notification_email_outbox WHERE id=$1',
        [retry.id],
      )
    )[0],
    { status: 'SENT', attempts: 2 },
  );
  const [exhausted] = await source.query(
    `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id,attempts,first_attempt_at)
    VALUES ($1,'CARD_ASSIGNED','exhausted',$2,$3,5,now()-interval '1 hour') RETURNING id`,
    [user.id, board.id, card.id],
  );
  await new TaskEmailDispatcher(source, { send: async () => 'RETRY' }).drain(
    50,
  );
  assert.deepEqual(
    (
      await source.query(
        'SELECT status,attempts FROM task_notification_email_outbox WHERE id=$1',
        [exhausted.id],
      )
    )[0],
    { status: 'FAILED', attempts: 6 },
  );
  await source.query(
    `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id,status,sent_at)
    SELECT $1,'CARD_ASSIGNED','rate-' || n,$2,$3,'SENT',now() FROM generate_series(1,3) AS n`,
    [user.id, board.id, card.id],
  );
  const [limited] = await source.query(
    `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id)
    VALUES ($1,'CARD_ASSIGNED','limited',$2,$3) RETURNING id`,
    [user.id, board.id, card.id],
  );
  await new TaskEmailDispatcher(source, recoveryMailer).drain(50);
  assert.equal(
    (
      await source.query(
        'SELECT status FROM task_notification_email_outbox WHERE id=$1',
        [limited.id],
      )
    )[0].status,
    'PENDING',
  );
  await source.query(
    "UPDATE task_notification_email_outbox SET created_at=now()-interval '25 hours' WHERE id=$1",
    [limited.id],
  );
  await new TaskEmailDispatcher(source, recoveryMailer).drain(50);
  assert.equal(
    (
      await source.query(
        'SELECT status FROM task_notification_email_outbox WHERE id=$1',
        [limited.id],
      )
    )[0].status,
    'CANCELLED',
  );
  console.log(
    'PASS: rollback, lease recovery, ambiguous status, rate deferral and stale cancellation',
  );
  await source.query(
    "UPDATE task_notification_email_outbox SET sent_at=now()-interval '25 hours' WHERE status='SENT'",
  );
  await source.query(
    "UPDATE task_notification_email_outbox SET last_attempt_at=now()-interval '25 hours' WHERE status='UNKNOWN'",
  );
  await source.query(
    `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id)
    SELECT $1,'CARD_ASSIGNED','burst-' || n,$2,$3 FROM generate_series(1,12) n`,
    [user.id, board.id, card.id],
  );
  const burstMailer = new FakeTaskNotificationMailer();
  await Promise.all([
    new TaskEmailDispatcher(source, burstMailer).drain(50),
    new TaskEmailDispatcher(source, burstMailer).drain(50),
  ]);
  assert.equal(burstMailer.deliveries.length, 10);
  assert.equal(
    (
      await source.query(
        "SELECT count(*)::int AS n FROM task_notification_email_outbox WHERE occurrence_key LIKE 'burst-%' AND status='PENDING'",
      )
    )[0].n,
    2,
  );
  await source.query(
    "UPDATE task_notification_email_outbox SET status='CANCELLED' WHERE occurrence_key LIKE 'burst-%' AND status='PENDING'",
  );
  console.log('PASS: concurrent dispatch respects the rolling recipient limit');
  const [leaseUser] = await source.query(
    "INSERT INTO users(email,display_name,email_verified_at) VALUES ('lease-p405@example.test','Lease',now()) RETURNING id",
  );
  await source.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')",
    [board.id, leaseUser.id],
  );
  await source.query(
    'INSERT INTO notification_preferences(user_id,email_card_assigned) VALUES ($1,true)',
    [leaseUser.id],
  );
  await source.query(
    `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id,status,lease_owner,lease_until,first_attempt_at,last_attempt_at,attempts)
    SELECT $1,'CARD_ASSIGNED','expired-burst-' || n,$2,$3,'PROCESSING',gen_random_uuid(),now()-interval '1 minute',now(),now(),1 FROM generate_series(1,10) n`,
    [leaseUser.id, board.id, card.id],
  );
  const [afterCrash] = await source.query(
    `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id) VALUES ($1,'CARD_ASSIGNED','after-crash',$2,$3) RETURNING id`,
    [leaseUser.id, board.id, card.id],
  );
  const crashMailer = new FakeTaskNotificationMailer();
  await new TaskEmailDispatcher(source, crashMailer).drain(1);
  assert.equal(crashMailer.deliveries.length, 0);
  assert.equal(
    (
      await source.query(
        'SELECT status FROM task_notification_email_outbox WHERE id=$1',
        [afterCrash.id],
      )
    )[0].status,
    'PENDING',
  );
  await source.query(
    'DELETE FROM task_notification_email_outbox WHERE recipient_user_id=$1',
    [leaseUser.id],
  );
  await source.query(
    'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
    [board.id, leaseUser.id],
  );
  await source.query('DELETE FROM notification_preferences WHERE user_id=$1', [
    leaseUser.id,
  ]);
  await source.query('DELETE FROM users WHERE id=$1', [leaseUser.id]);
  console.log(
    'PASS: expired in-flight attempts still count against the recipient limit',
  );
  const [unassignedCard] = await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position,due_date)
    VALUES ($1,$2,$3,'Second task',200,now()+interval '1 hour') RETURNING id`,
    [board.id, column.id, user.id],
  );
  await source.query(
    'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
    [unassignedCard.id, user.id],
  );
  await scanner().scan(50);
  const [unassignedWork] = await source.query(
    'SELECT id FROM task_notification_email_outbox WHERE card_id=$1',
    [unassignedCard.id],
  );
  assert.ok(unassignedWork);
  await source.query(
    'DELETE FROM card_assignees WHERE card_id=$1 AND user_id=$2',
    [unassignedCard.id, user.id],
  );
  await new TaskEmailDispatcher(source, fake).drain(50);
  assert.equal(
    (
      await source.query(
        'SELECT status FROM task_notification_email_outbox WHERE id=$1',
        [unassignedWork.id],
      )
    )[0].status,
    'CANCELLED',
  );
  const [revoked] = await insert('revoked');
  await source.query(
    'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
    [board.id, user.id],
  );
  await new TaskEmailDispatcher(source, fake).drain(50);
  assert.equal(
    (
      await source.query(
        'SELECT status FROM task_notification_email_outbox WHERE id=$1',
        [revoked.id],
      )
    )[0].status,
    'CANCELLED',
  );
  assert.equal(fake.deliveries.length, 1);
  await source.query(
    `INSERT INTO workspace_members(workspace_id,user_id,role)
    SELECT workspace_id,$2,'ADMIN' FROM boards WHERE id=$1
    ON CONFLICT (workspace_id,user_id) DO UPDATE SET role='ADMIN'`,
    [board.id, user.id],
  );
  await source.query(
    "UPDATE task_notification_email_outbox SET sent_at=now()-interval '25 hours' WHERE status='SENT'",
  );
  await source.query(
    "UPDATE task_notification_email_outbox SET first_attempt_at=now()-interval '25 hours', last_attempt_at=now()-interval '25 hours' WHERE status='UNKNOWN'",
  );
  const createAccessMail = async (key) =>
    (
      await source.query(
        `INSERT INTO task_notification_email_outbox
    (recipient_user_id,kind,occurrence_key,board_id,card_id)
    VALUES ($1,'CARD_ASSIGNED',$2,$3,$4) RETURNING id`,
        [user.id, key, board.id, card.id],
      )
    )[0];
  const privateAdmin = await createAccessMail('private-admin');
  await new TaskEmailDispatcher(source, fake).drain(50);
  assert.equal(
    (
      await source.query(
        'SELECT status FROM task_notification_email_outbox WHERE id=$1',
        [privateAdmin.id],
      )
    )[0].status,
    'CANCELLED',
  );
  await source.query(
    "UPDATE boards SET visibility='WORKSPACE_VISIBLE' WHERE id=$1",
    [board.id],
  );
  const visibleAdmin = await createAccessMail('visible-admin');
  await new TaskEmailDispatcher(source, fake).drain(50);
  assert.equal(
    (
      await source.query(
        'SELECT status FROM task_notification_email_outbox WHERE id=$1',
        [visibleAdmin.id],
      )
    )[0].status,
    'SENT',
  );
  assert.equal(fake.deliveries.length, 2);
  console.log(
    'PASS: opt-out, unverified account, unassignment, revoked access and private versus workspace-visible ACL',
  );
  await source.query("UPDATE boards SET visibility='PRIVATE' WHERE id=$1", [
    board.id,
  ]);
  const [guest] = await source.query(
    "INSERT INTO users(email,display_name,email_verified_at) VALUES ('guest-p405@example.test','Guest',now()) RETURNING id",
  );
  await source.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'MEMBER')",
    [board.id, guest.id],
  );
  await source.query(
    'INSERT INTO notification_preferences(user_id,in_app_due_reminder,email_due_reminder) VALUES ($1,false,true)',
    [guest.id],
  );
  const guestCards = await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position,due_date)
    SELECT $1,$2,$3,'Guest task',n,now()+interval '1 hour' FROM unnest(ARRAY[250,260]) n RETURNING id`,
    [board.id, column.id, user.id],
  );
  for (const item of guestCards)
    await source.query(
      'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
      [item.id, guest.id],
    );
  await scanner().scan(50);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM task_notification_email_outbox WHERE recipient_user_id=$1',
        [guest.id],
      )
    )[0].n,
    2,
  );
  const guestMailer = new FakeTaskNotificationMailer();
  await new TaskEmailDispatcher(source, guestMailer).drain(1);
  await source.query(
    'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
    [board.id, guest.id],
  );
  await new TaskEmailDispatcher(source, guestMailer).drain(50);
  assert.equal(guestMailer.deliveries.length, 1);
  assert.deepEqual(
    (
      await source.query(
        'SELECT status FROM task_notification_email_outbox WHERE recipient_user_id=$1 ORDER BY status',
        [guest.id],
      )
    ).map((row) => row.status),
    ['CANCELLED', 'SENT'],
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM workspace_members WHERE user_id=$1 AND workspace_id=(SELECT workspace_id FROM boards WHERE id=$2)',
        [guest.id, board.id],
      )
    )[0].n,
    0,
  );
  await source.query(
    'DELETE FROM task_notification_email_outbox WHERE recipient_user_id=$1',
    [guest.id],
  );
  for (const item of guestCards)
    await source.query('DELETE FROM cards WHERE id=$1', [item.id]);
  console.log(
    'PASS: explicit Board guest receives opted-in mail only while access remains',
  );
  await source.query(
    'UPDATE notification_preferences SET in_app_due_reminder=true, email_due_reminder=true WHERE user_id=$1',
    [user.id],
  );
  await source.query("UPDATE boards SET visibility='PRIVATE' WHERE id=$1", [
    board.id,
  ]);
  await source.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER') ON CONFLICT DO NOTHING",
    [board.id, user.id],
  );
  for (const scenario of [
    'archive-card',
    'unassign',
    'revoke',
    'archive-board',
    'preferences',
  ]) {
    const [target] = await source.query(
      `INSERT INTO cards(board_id,column_id,created_by_id,title,position,due_date)
      VALUES ($1,$2,$3,'Race fixture',500,now()+interval '1 hour') RETURNING id`,
      [board.id, column.id, user.id],
    );
    await source.query(
      'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
      [target.id, user.id],
    );
    const lock = source.createQueryRunner();
    await lock.connect();
    await lock.startTransaction();
    try {
      if (scenario === 'preferences') {
        await lock.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [
          user.id,
        ]);
        await lock.query(
          'UPDATE notification_preferences SET in_app_due_reminder=false,email_due_reminder=false WHERE user_id=$1',
          [user.id],
        );
      } else {
        await lock.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [
          board.id,
        ]);
        if (scenario === 'archive-card')
          await lock.query(
            'UPDATE cards SET is_archived=true,archived_at=now() WHERE id=$1',
            [target.id],
          );
        if (scenario === 'unassign')
          await lock.query(
            'DELETE FROM card_assignees WHERE card_id=$1 AND user_id=$2',
            [target.id, user.id],
          );
        if (scenario === 'revoke')
          await lock.query(
            'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
            [board.id, user.id],
          );
        if (scenario === 'archive-board')
          await lock.query(
            'UPDATE boards SET is_archived=true,archived_at=now() WHERE id=$1',
            [board.id],
          );
      }
      const scanning = scanner().scan(50);
      let blocked = false;
      for (let i = 0; i < 200 && !blocked; i++) {
        const [state] = await source.query(
          `SELECT EXISTS(SELECT 1 FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
            AND query LIKE $1) AS blocked`,
          [
            scenario === 'preferences'
              ? '%FROM "users"%'
              : 'SELECT id FROM boards%',
          ],
        );
        blocked = state.blocked;
        if (!blocked) await delay(50);
      }
      assert.equal(blocked, true, scenario);
      await lock.commitTransaction();
      await scanning;
    } finally {
      if (lock.isTransactionActive) await lock.rollbackTransaction();
      await lock.release();
    }
    assert.equal(
      (
        await source.query(
          'SELECT count(*)::int AS n FROM task_notification_email_outbox WHERE card_id=$1',
          [target.id],
        )
      )[0].n,
      0,
      scenario,
    );
    assert.equal(
      (
        await source.query(
          'SELECT count(*)::int AS n FROM user_notifications WHERE card_id=$1',
          [target.id],
        )
      )[0].n,
      0,
      scenario,
    );
    await source.query('DELETE FROM cards WHERE id=$1', [target.id]);
    await source.query(
      'UPDATE boards SET is_archived=false,archived_at=NULL WHERE id=$1',
      [board.id],
    );
    await source.query(
      "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER') ON CONFLICT DO NOTHING",
      [board.id, user.id],
    );
    await source.query(
      'UPDATE notification_preferences SET in_app_due_reminder=true,email_due_reminder=true WHERE user_id=$1',
      [user.id],
    );
  }
  console.log(
    'PASS: archive, unassignment, access revocation and preference races are rechecked',
  );
  await source.query(
    "UPDATE boards SET visibility='WORKSPACE_VISIBLE' WHERE id=$1",
    [board.id],
  );
  await source.query(
    'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
    [board.id, user.id],
  );
  const [workspaceRace] = await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position,due_date)
    VALUES ($1,$2,$3,'Workspace grant race',500,now()+interval '1 hour') RETURNING id`,
    [board.id, column.id, user.id],
  );
  await source.query(
    'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
    [workspaceRace.id, user.id],
  );
  const workspaceLock = source.createQueryRunner();
  await workspaceLock.connect();
  await workspaceLock.startTransaction();
  try {
    await workspaceLock.query(
      'DELETE FROM workspace_members WHERE user_id=$1 AND workspace_id=(SELECT workspace_id FROM boards WHERE id=$2)',
      [user.id, board.id],
    );
    const scanning = scanner().scan(50);
    let blocked = false;
    for (let i = 0; i < 200 && !blocked; i++) {
      const [state] =
        await source.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT wm.user_id%') AS blocked`);
      blocked = state.blocked;
      if (!blocked) await delay(50);
    }
    assert.equal(blocked, true);
    await workspaceLock.commitTransaction();
    await scanning;
  } finally {
    if (workspaceLock.isTransactionActive)
      await workspaceLock.rollbackTransaction();
    await workspaceLock.release();
  }
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM task_notification_email_outbox WHERE card_id=$1',
        [workspaceRace.id],
      )
    )[0].n,
    0,
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM user_notifications WHERE card_id=$1',
        [workspaceRace.id],
      )
    )[0].n,
    0,
  );
  await source.query('DELETE FROM cards WHERE id=$1', [workspaceRace.id]);
  await source.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) SELECT workspace_id,$2,'ADMIN' FROM boards WHERE id=$1 ON CONFLICT DO NOTHING",
    [board.id, user.id],
  );
  await source.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER') ON CONFLICT DO NOTHING",
    [board.id, user.id],
  );
  await source.query("UPDATE boards SET visibility='PRIVATE' WHERE id=$1", [
    board.id,
  ]);
  console.log(
    'PASS: Workspace read grant removal is serialized against reminder creation',
  );
  const [raceCard] = await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position,due_date)
    VALUES ($1,$2,$3,'Race task',300,now()+interval '1 hour') RETURNING id`,
    [board.id, column.id, user.id],
  );
  await source.query(
    'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
    [raceCard.id, user.id],
  );
  const runner = source.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [
      board.id,
    ]);
    await runner.query(
      "UPDATE cards SET due_date=now()+interval '3 days' WHERE id=$1",
      [raceCard.id],
    );
    const scanning = scanner().scan(50);
    let blocked = false;
    for (let i = 0; i < 200 && !blocked; i++) {
      const [state] =
        await source.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM boards%') AS blocked`);
      blocked = state.blocked;
      if (!blocked) await delay(50);
    }
    assert.equal(blocked, true);
    await runner.commitTransaction();
    await scanning;
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM task_notification_email_outbox WHERE card_id=$1',
        [raceCard.id],
      )
    )[0].n,
    0,
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM user_notifications WHERE card_id=$1',
        [raceCard.id],
      )
    )[0].n,
    0,
  );
  console.log(
    'PASS: due edit committed while scanner waits is rechecked under the Board lock',
  );
  await verifyTaskStabilization({ source, TaskEmailDispatcher, scanner });
  const [lifecycleCard] = await source.query(
    `INSERT INTO cards(board_id,column_id,created_by_id,title,position,due_date)
    VALUES ($1,$2,$3,'Worker task',400,now()+interval '1 hour') RETURNING id`,
    [board.id, column.id, user.id],
  );
  await source.query(
    'INSERT INTO card_assignees(card_id,user_id) VALUES ($1,$2)',
    [lifecycleCard.id, user.id],
  );
  Object.assign(process.env, {
    DATABASE_NAME: name,
    JWT_SECRET: 'p405-test-secret-at-least-32-characters-long',
    TASK_NOTIFICATION_JOBS_ENABLED: 'true',
    TASK_NOTIFICATION_EMAIL_ENABLED: 'true',
    TASK_NOTIFICATION_POLL_SECONDS: '15',
    TASK_NOTIFICATION_BATCH_SIZE: '50',
    MAIL_TRANSPORT: 'fake',
    LOG_LEVEL: 'silent',
    AVATAR_STORAGE_DRIVER: 'disabled',
  });
  const { Test } = require('@nestjs/testing');
  const { AppModule } = require('../../dist/app.module.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(source)
    .compile();
  app = module.createNestApplication();
  await app.init();
  const lifecycleMailer = app.get(TaskNotificationMailer);
  for (
    let i = 0;
    i < 200 &&
    !lifecycleMailer.deliveries.some(
      (item) => item.cardId === lifecycleCard.id,
    );
    i++
  )
    await delay(100);
  assert.ok(
    lifecycleMailer.deliveries.some((item) => item.cardId === lifecycleCard.id),
  );
  console.log(
    'PASS: enabled Nest lifecycle schedules and sends through fake mail',
  );
} finally {
  if (app) await app.close();
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
