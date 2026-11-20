import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
// Explicit local-only opt-in. Never load .env or infer a production target.
assert.equal(process.env.PUSH_DATABASE_TESTS, 'local-only');
assert.ok(
  ['127.0.0.1', 'localhost', '::1'].includes(process.env.DATABASE_HOST),
);
assert.notEqual(process.env.NODE_ENV, 'production');
assert.match(
  process.env.DATABASE_NAME ?? '',
  /test|integration/i,
  'Use an explicitly designated test database as admin connection',
);
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { ConfigService } = require('@nestjs/config');
const { databaseOptions } = require('../../dist/database/database-options.js');
const {
  PushScheduleService,
} = require('../../dist/api/push/push-schedule.service.js');
const {
  PushRegistryService,
} = require('../../dist/api/push/push-registry.service.js');
const {
  PushDispatcher,
} = require('../../dist/api/push/push-dispatcher.service.js');
const {
  PushEnqueuer,
} = require('../../dist/api/push/push-enqueuer.service.js');
const {
  NotificationService,
} = require('../../dist/api/notifications/notification.service.js');
const {
  NotificationResolver,
} = require('../../dist/api/notifications/notification-resolver.service.js');
const {
  UserNotification,
} = require('../../dist/api/notifications/entities/user-notification.entity.js');
const options = databaseOptions(process.env),
  name = 'kanban_quiet_test_' + randomBytes(8).toString('hex');
// Generated name is verified before CREATE/DROP; only this fixture's owned DB is removed.
assert.match(name, /^kanban_quiet_test_[a-f0-9]{16}$/);
const admin = new Client({ ...options, user: options.username });
let source,
  created = false;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  source = await new DataSource({ ...options, database: name }).initialize();
  const all = source.migrations;
  source.migrations = all.filter((m) => !m.name.startsWith('PushQuietHours'));
  await source.runMigrations();
  const [user] = await source.query(
    "INSERT INTO users(email,display_name,email_verified_at) VALUES ('quiet@test.invalid','Quiet',now()) RETURNING id",
  );
  source.migrations = all;
  await source.runMigrations();
  const schedules = new PushScheduleService(source);
  const session = {
    userId: user.id,
    authVersion: 0,
    expiresAt: Date.now() + 3600_000,
  };
  const defaults = {
    enabled: false,
    startLocal: '22:00',
    endLocal: '07:00',
    timeZone: 'UTC',
  };
  assert.deepEqual(await schedules.get(user.id), defaults);
  assert.equal(
    (
      await source.query('SELECT count(*)::int AS n FROM user_push_schedules')
    )[0].n,
    0,
  );
  await schedules.update(session, { enabled: false });
  assert.equal(
    (
      await source.query('SELECT count(*)::int AS n FROM user_push_schedules')
    )[0].n,
    0,
  );
  await schedules.update(session, { startLocal: '22:15' });
  await Promise.all([
    schedules.update(session, { startLocal: '21:45' }),
    schedules.update(session, { endLocal: '08:00' }),
  ]);
  assert.deepEqual(await schedules.get(user.id), {
    ...defaults,
    startLocal: '21:45',
    endLocal: '08:00',
  });
  await assert.rejects(
    source.query(
      "UPDATE user_push_schedules SET enabled=true,start_local='07:00',end_local='07:00'",
    ),
  );
  await assert.rejects(
    source.query("UPDATE user_push_schedules SET start_local='22:01'"),
  );
  console.log(
    'PASS migration upgrade, default/no-op no-write, SQL constraints and concurrent sparse PATCH',
  );
  const [board] = await source.query(
    "INSERT INTO boards(name,created_by_id) VALUES ('Quiet board',$1) RETURNING id",
    [user.id],
  );
  await source.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')",
    [board.id, user.id],
  );
  const [column] = await source.query(
    "INSERT INTO board_columns(board_id,name,position) VALUES ($1,'Column',100) RETURNING id",
    [board.id],
  );
  const [card] = await source.query(
    "INSERT INTO cards(board_id,column_id,created_by_id,title,position) VALUES ($1,$2,$3,'Card',100) RETURNING id",
    [board.id, column.id, user.id],
  );
  const config = new ConfigService({
    PUSH_NOTIFICATIONS_ENABLED: true,
    PUSH_PROJECT_ID: randomUUID(),
    PUSH_APP_ENVIRONMENT: 'development',
    PUSH_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  });
  const registry = new PushRegistryService(source, config);
  await registry.register(session, {
    installationId: randomUUID(),
    projectId: config.get('PUSH_PROJECT_ID'),
    appEnvironment: 'development',
    platform: 'android',
    expoPushToken: 'ExpoPushToken[quietabcdefghijklmnop]',
  });
  await registry.update(session, true);
  const recorder = new NotificationService(
    source.getRepository(UserNotification),
    new PushEnqueuer(config),
  );
  const {
    NotificationInvitationResolvers,
  } = require('../../dist/api/notifications/notification-invitation-resolvers.js');
  const resolver = new NotificationResolver(
    new NotificationInvitationResolvers(),
  );
  const sends = [],
    receipts = [];
  const provider = {
    send: async (_token, id) => {
      sends.push(id);
      return { type: 'ticket', ticketId: randomUUID() };
    },
    receipt: async (id) => {
      receipts.push(id);
      return { type: 'accepted' };
    },
  };
  const worker = () => new PushDispatcher(source, config, provider, resolver);
  const record = () =>
    source.transaction((m) =>
      recorder.record(m, {
        kind: 'CARD_ASSIGNED',
        recipientUserId: user.id,
        cardId: card.id,
        occurrenceKey: randomUUID(),
      }),
    );
  const jobs = () =>
    source.query('SELECT * FROM push_delivery_outbox ORDER BY created_at,id');
  // Put current real instant in an almost-full-day quiet interval without faking DB clock.
  const [{ utc }] = await source.query(
    "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','HH24:MI') AS utc",
  );
  const [h, min] = utc.split(':').map(Number),
    quarter = h * 60 + Math.floor(min / 15) * 15;
  const clock = (n) =>
    `${String(Math.floor((n % 1440) / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  await schedules.update(session, {
    enabled: true,
    startLocal: clock(quarter),
    endLocal: clock(quarter + 1425),
  });
  await record();
  const original = (await jobs())[0];
  await Promise.all([worker().drain(), worker().drain()]);
  let job = (await jobs())[0];
  assert.equal(sends.length, 0);
  assert.equal(job.status, 'PENDING');
  assert.equal(job.last_error_code, 'QUIET_HOURS');
  assert.equal(job.attempts, 0);
  assert.equal(job.expires_at.getTime(), original.expires_at.getTime());
  assert.ok(job.next_attempt_at > new Date());
  assert.equal(
    (await source.query('SELECT count(*)::int AS n FROM user_notifications'))[0]
      .n,
    1,
  );
  await Promise.all([worker().drain(), worker().drain()]);
  assert.equal(sends.length, 0);
  await schedules.update(session, { enabled: false });
  await Promise.all([worker().drain(), worker().drain()]);
  assert.equal(sends.length, 1);
  assert.equal((await jobs())[0].status, 'TICKET');
  console.log(
    'PASS two-worker quiet defer, Inbox unchanged, stable TTL/attempts, OFF wake and one send',
  );
  await schedules.update(session, { enabled: true });
  await source.query(
    "UPDATE push_delivery_outbox SET next_attempt_at=now()-interval '1 second' WHERE status='TICKET'",
  );
  await worker().drain();
  assert.equal(receipts.length, 1);
  assert.equal(sends.length, 1);
  // Independent scenarios do not inherit the one-second provider-send throttle.
  await source.query('DELETE FROM push_delivery_outbox');
  await record();
  job = (await jobs()).find((j) => j.status === 'PENDING');
  await source.query(
    "UPDATE push_delivery_outbox SET expires_at=now()+interval '1 minute' WHERE id=$1",
    [job.id],
  );
  await worker().drain();
  const expired = (await jobs()).find((j) => j.id === job.id);
  assert.equal(expired.status, 'CANCELLED');
  assert.equal(expired.last_error_code, 'EXPIRED');
  assert.equal(sends.length, 1);
  console.log(
    'PASS receipt polling during quiet and terminal expiry before release',
  );
  // A User lock held by schedule mutation blocks worker preparation; its later
  // authoritative read must see the committed new state, not claim-time state.
  await schedules.update(session, { enabled: false });
  await record();
  const lock = source.createQueryRunner();
  await lock.connect();
  await lock.startTransaction();
  try {
    await lock.query('SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE', [
      user.id,
    ]);
    await lock.query(
      'UPDATE user_push_schedules SET enabled=true WHERE user_id=$1',
      [user.id],
    );
    const draining = worker().drain();
    // Wait for observable PG lock state, never infer ordering from a fixed sleep.
    let blocked = false;
    for (let i = 0; i < 500 && !blocked; i++) {
      const [state] = await source.query(
        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock') AS blocked",
      );
      blocked = state.blocked;
    }
    assert.ok(blocked, 'worker preparation must wait for schedule User lock');
    await lock.commitTransaction();
    await draining;
    assert.equal(sends.length, 1);
  } finally {
    if (lock.isTransactionActive) await lock.rollbackTransaction();
    await lock.release();
  }
  console.log(
    'PASS late schedule edit serializes before worker send-time preparation',
  );
  // A timezone edit uses the same User lock. Wake a deferred row immediately
  // when the saved wall interval is no longer quiet in the new account zone.
  await schedules.update(session, {
    startLocal: clock(quarter),
    endLocal: clock(quarter + 60),
  });
  await source.query(
    "UPDATE push_delivery_outbox SET next_attempt_at=now()-interval '1 second' WHERE status='PENDING'",
  );
  await worker().drain();
  const held = (await jobs()).find((j) => j.status === 'PENDING');
  assert.ok(held);
  assert.equal(sends.length, 1);
  await source.transaction(async (m) => {
    await m.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    await m.query(
      "INSERT INTO user_preferences(user_id,time_zone) VALUES ($1,'Asia/Tokyo') ON CONFLICT(user_id) DO UPDATE SET time_zone=EXCLUDED.time_zone",
      [user.id],
    );
  });
  await Promise.all([worker().drain(), worker().drain()]);
  assert.equal(sends.length, 2);
  assert.equal((await jobs()).find((j) => j.id === held.id).status, 'TICKET');
  assert.equal((await schedules.get(user.id)).startLocal, clock(quarter));
  console.log(
    'PASS authoritative account timezone wakes deferred job without rewriting clocks',
  );
  const {
    eraseAccountPrivateState,
  } = require('../../dist/api/users/account-deletion/account-deletion-state.js');
  const { User } = require('../../dist/api/users/entities/user.entity.js');
  // Independent account meets erasure's zero-owned-Board precondition without
  // destructive cleanup of the collaborative fixture graph.
  const [erased] = await source.query(
    "INSERT INTO users(email,display_name) VALUES ('erased@test.invalid','Erased') RETURNING id",
  );
  await source.query('INSERT INTO user_push_schedules(user_id) VALUES ($1)', [
    erased.id,
  ]);
  await source.transaction(async (m) => {
    await m.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [erased.id]);
    await eraseAccountPrivateState(
      m,
      await m.getRepository(User).findOneByOrFail({ id: erased.id }),
    );
  });
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM user_push_schedules WHERE user_id=$1',
        [erased.id],
      )
    )[0].n,
    0,
  );
  const [temporary] = await source.query(
    "INSERT INTO users(email,display_name) VALUES ('cascade@test.invalid','Cascade') RETURNING id",
  );
  await source.query('INSERT INTO user_push_schedules(user_id) VALUES ($1)', [
    temporary.id,
  ]);
  await source.query('DELETE FROM users WHERE id=$1', [temporary.id]);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM user_push_schedules WHERE user_id=$1',
        [temporary.id],
      )
    )[0].n,
    0,
  );
  console.log('PASS soft-account private erasure and physical User FK cascade');
  console.log(
    'Quiet-hours PostgreSQL integration PASS; fake provider only, no real EPS',
  );
} finally {
  await source?.destroy();
  if (created) {
    assert.match(name, /^kanban_quiet_test_[a-f0-9]{16}$/);
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
  await admin.end();
}
