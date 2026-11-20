import assert from 'node:assert/strict';
import console from 'node:console';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
assert.equal(process.env.PUSH_DATABASE_TESTS, 'local-only');
assert.ok(
  ['127.0.0.1', 'localhost', '::1'].includes(process.env.DATABASE_HOST),
);
assert.notEqual(process.env.NODE_ENV, 'production');
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { Client } = require('pg'),
  { DataSource } = require('typeorm'),
  { ConfigService } = require('@nestjs/config');
const { databaseOptions } = require('../../dist/database/database-options.js');
const {
  PushRegistryService,
} = require('../../dist/api/push/push-registry.service.js');
const {
  PushEnqueuer,
} = require('../../dist/api/push/push-enqueuer.service.js');
const {
  PushDispatcher,
} = require('../../dist/api/push/push-dispatcher.service.js');
const {
  NotificationService,
} = require('../../dist/api/notifications/notification.service.js');
const {
  UserNotification,
} = require('../../dist/api/notifications/entities/user-notification.entity.js');
const {
  NotificationResolver,
} = require('../../dist/api/notifications/notification-resolver.service.js');
const {
  NotificationInvitationResolvers,
} = require('../../dist/api/notifications/notification-invitation-resolvers.js');
const options = databaseOptions(process.env),
  name = 'kanban_push_' + randomBytes(8).toString('hex');
const admin = new Client({ ...options, user: options.username });
let source,
  created = false,
  groups = 0;
const pass = (label) => {
  groups++;
  console.log('PASS: ' + label);
};
try {
  await admin.connect();
  await admin.query('CREATE DATABASE "' + name + '"');
  created = true;
  source = await new DataSource({ ...options, database: name }).initialize();
  // Verify the migration upgrades real legacy data without enabling or enqueueing.
  const all = source.migrations;
  source.migrations = all.filter((m) => !m.name.startsWith('NativePush'));
  await source.runMigrations();
  const [a] = await source.query(
    "INSERT INTO users(email,display_name,email_verified_at) VALUES ('a@push.test','Private A',now()) RETURNING id",
  );
  const [b] = await source.query(
    "INSERT INTO users(email,display_name,email_verified_at) VALUES ('b@push.test','Private B',now()) RETURNING id",
  );
  const [board] = await source.query(
    "INSERT INTO boards(name,created_by_id) VALUES ('Secret board',$1) RETURNING id,workspace_id",
    [a.id],
  );
  await source.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')",
    [board.id, a.id],
  );
  const [column] = await source.query(
    "INSERT INTO board_columns(board_id,name,position) VALUES ($1,'Private column',100) RETURNING id",
    [board.id],
  );
  const [card] = await source.query(
    "INSERT INTO cards(board_id,column_id,created_by_id,title,position) VALUES ($1,$2,$3,'Secret card',100) RETURNING id",
    [board.id, column.id, a.id],
  );
  source.migrations = all;
  await source.runMigrations();
  assert.equal(
    (await source.query('SELECT count(*)::int AS n FROM push_devices'))[0].n,
    0,
  );
  assert.equal(
    (await source.query('SELECT title FROM cards WHERE id=$1', [card.id]))[0]
      .title,
    'Secret card',
  );
  assert.equal(
    (
      await source.query('SELECT count(*)::int AS n FROM user_push_preferences')
    )[0].n,
    0,
  );
  await assert.rejects(
    () =>
      all
        .find((m) => m.name.startsWith('NativePush'))
        .down(source.createQueryRunner()),
    /forward fix/,
  );
  pass(
    'clean schema plus legacy upgrade preserves content and defaults OFF; rollback requires forward fix',
  );
  const config = new ConfigService({
    PUSH_NOTIFICATIONS_ENABLED: true,
    PUSH_PROJECT_ID: '45269d99-0d21-44b6-ab8f-e73e80576fee',
    PUSH_APP_ENVIRONMENT: 'development',
    PUSH_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  });
  const registry = new PushRegistryService(source, config),
    enqueuer = new PushEnqueuer(config);
  const recorder = new NotificationService(
    source.getRepository(UserNotification),
    enqueuer,
  );
  const resolver = new NotificationResolver(
    new NotificationInvitationResolvers(),
  );
  const session = (userId) => ({
    userId,
    authVersion: 0,
    expiresAt: Date.now() + 3600_000,
  });
  const A = session(a.id),
    B = session(b.id),
    installationId = randomUUID(),
    otherInstallation = randomUUID();
  const input = {
    installationId,
    expoPushToken: 'ExpoPushToken[abcdefghijklmnop]',
    platform: 'android',
    appEnvironment: 'development',
    projectId: config.get('PUSH_PROJECT_ID'),
  };
  const count = async (table) =>
    Number(
      (await source.query('SELECT count(*)::int AS n FROM ' + table))[0].n,
    );
  let occurrence = 0;
  const record = () =>
    source.transaction((m) =>
      recorder.record(m, {
        kind: 'CARD_ASSIGNED',
        recipientUserId: a.id,
        cardId: card.id,
        occurrenceKey: 'push-' + ++occurrence,
      }),
    );
  assert.deepEqual(await registry.get(a.id), {
    enabled: false,
    deliveryAvailable: true,
  });
  await assert.rejects(
    () => registry.update(A, true),
    (e) => e.getStatus() === 409,
  );
  const off = new PushRegistryService(
    source,
    new ConfigService({ PUSH_NOTIFICATIONS_ENABLED: false }),
  );
  assert.equal((await off.get(a.id)).deliveryAvailable, false);
  await assert.rejects(
    () => off.register(A, input),
    (e) => e.getStatus() === 503,
  );
  await off.update(A, false);
  await assert.rejects(
    () => registry.register(A, { ...input, projectId: randomUUID() }),
    (e) => e.getStatus() === 400,
  );
  await registry.register(A, input);
  const [stored] = await source.query('SELECT * FROM push_devices');
  assert(!JSON.stringify(stored).includes(input.expoPushToken));
  assert(stored.encrypted_token.startsWith('v1.'));
  assert.deepEqual(await registry.current(B, installationId), {
    registered: false,
    eligible: false,
  });
  await registry.remove(B, installationId);
  assert.equal((await registry.current(A, installationId)).eligible, true);
  await assert.rejects(
    () => registry.register(B, { ...input, installationId: otherInstallation }),
    (e) => e.getStatus() === 409,
  );
  pass(
    'flag-off gates, current ownership, foreign deletes, routing uniqueness and encrypted storage',
  );
  await record();
  assert.equal(await count('push_delivery_outbox'), 0);
  await registry.update(A, true);
  assert.equal(await count('push_delivery_outbox'), 0);
  await registry.register(A, {
    ...input,
    installationId: otherInstallation,
    expoPushToken: 'ExpoPushToken[qrstuvwxyzabcdef]',
  });
  const createdRecord = await record();
  assert.equal(await count('push_delivery_outbox'), 2);
  const duplicate = await source.transaction((m) =>
    recorder.record(m, {
      kind: 'CARD_ASSIGNED',
      recipientUserId: a.id,
      cardId: card.id,
      occurrenceKey: 'push-' + occurrence,
    }),
  );
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.notificationId, createdRecord.notificationId);
  assert.equal(await count('push_delivery_outbox'), 2);
  await source.query(
    'INSERT INTO notification_preferences(user_id,in_app_card_assigned) VALUES ($1,false)',
    [a.id],
  );
  const before = await count('user_notifications');
  assert.equal((await record()).status, 'disabled');
  assert.equal(await count('user_notifications'), before);
  await source.query(
    'UPDATE notification_preferences SET in_app_card_assigned=true WHERE user_id=$1',
    [a.id],
  );
  await assert.rejects(
    () =>
      source.transaction(async (m) => {
        await recorder.record(m, {
          kind: 'CARD_ASSIGNED',
          recipientUserId: a.id,
          cardId: card.id,
          occurrenceKey: 'rollback',
        });
        throw new Error('rollback');
      }),
    /rollback/,
  );
  assert.equal(await count('push_delivery_outbox'), 2);
  pass(
    'same-transaction two-device fanout, duplicate/suppressed rows, rollback, no backfill',
  );
  await registry.register(A, {
    ...input,
    expoPushToken: 'ExpoPushToken[rotationabcdefghijkl]',
  });
  assert.equal(
    (
      await source.query(
        'SELECT status FROM push_delivery_outbox WHERE device_id=$1',
        [stored.id],
      )
    )[0].status,
    'CANCELLED',
  );
  const rotated = {
    ...input,
    expoPushToken: 'ExpoPushToken[rotationabcdefghijkl]',
  };
  // A fresh login is required after a DELETE has retired the previous JWT.
  B.expiresAt += 60_000;
  await assert.rejects(
    () =>
      registry.register(B, {
        ...rotated,
        expoPushToken: 'ExpoPushToken[foreignabcdefghijkl]',
      }),
    (e) => e.getStatus() === 409,
  );
  assert.equal((await registry.current(A, installationId)).eligible, true);
  await registry.register(B, rotated);
  assert.deepEqual(await registry.current(A, installationId), {
    registered: false,
    eligible: false,
  });
  await assert.rejects(
    () => registry.register(A, rotated),
    (e) => e.getStatus() === 409,
  );
  await registry.remove(A, installationId);
  assert.equal((await registry.current(B, installationId)).eligible, true);
  const freshA = { ...A, expiresAt: B.expiresAt + 60_000 };
  // Concurrent renewals and an ownership transfer share the identity lock. A
  // renewal ordered after the transfer must be fenced; either ordering leaves
  // exactly one fresh-A-owned installation and cannot resurrect B's jobs.
  const transfer = await Promise.allSettled([
    registry.register(B, rotated),
    registry.register(freshA, rotated),
    registry.register(freshA, rotated),
  ]);
  assert.equal(transfer[1].status, 'fulfilled');
  assert.equal(transfer[2].status, 'fulfilled');
  assert.equal((await registry.current(freshA, installationId)).eligible, true);
  assert.equal((await registry.current(B, installationId)).registered, false);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM push_devices WHERE installation_id=$1',
        [installationId],
      )
    )[0].n,
    1,
  );
  await assert.rejects(
    () => registry.register(B, rotated),
    (e) => e.getStatus() === 409,
  );
  pass(
    'token rotation cancels old jobs, atomic A→B transfer fences stale A and foreign operations',
  );
  await registry.remove(A, otherInstallation);
  const deliveries = [];
  let outcome = { type: 'ticket', ticketId: 'ticket-1' },
    receipt = { type: 'accepted' },
    sendOverride;
  const provider = {
    send: async (token, id) => {
      deliveries.push({ token, id });
      return sendOverride ? sendOverride() : outcome;
    },
    receipt: async () => receipt,
  };
  const worker = () => new PushDispatcher(source, config, provider, resolver);
  const seed = async () => {
    await source.query('DELETE FROM push_delivery_outbox');
    await registry.register(freshA, rotated);
    await registry.update(freshA, true);
    await record();
    assert.equal(await count('push_delivery_outbox'), 1);
    return (await source.query('SELECT * FROM push_delivery_outbox'))[0];
  };
  const status = async (id) =>
    (
      await source.query(
        'SELECT status FROM push_delivery_outbox WHERE id=$1',
        [id],
      )
    )[0]?.status;
  let job = await seed();
  await worker().drain();
  assert.equal(await status(job.id), 'TICKET');
  assert.equal(
    (
      await source.query('SELECT read_at FROM user_notifications WHERE id=$1', [
        job.notification_id,
      ])
    )[0].read_at,
    null,
  );
  await source.query(
    'UPDATE push_delivery_outbox SET next_attempt_at=now() WHERE id=$1',
    [job.id],
  );
  await worker().drain();
  assert.equal(await status(job.id), 'ACCEPTED');
  assert.deepEqual(Object.keys(deliveries[0]).sort(), ['id', 'token']);
  assert.equal(deliveries[0].id, job.notification_id);
  pass('ticket versus accepted receipt, opaque IDs and Inbox remains unread');
  job = await seed();
  outcome = { type: 'retry', code: 'PROVIDER_UNAVAILABLE' };
  await worker().drain();
  let [retry] = await source.query(
    'SELECT * FROM push_delivery_outbox WHERE id=$1',
    [job.id],
  );
  assert.equal(retry.status, 'PENDING');
  assert.equal(retry.attempts, 1);
  assert(retry.next_attempt_at.getTime() > Date.now() + 20_000);
  await source.query(
    'UPDATE push_delivery_outbox SET attempts=5,next_attempt_at=now() WHERE id=$1',
    [job.id],
  );
  await worker().drain();
  assert.equal(await status(job.id), 'FAILED');
  job = await seed();
  outcome = { type: 'unknown', code: 'SEND_UNCERTAIN' };
  const sentBefore = deliveries.length;
  await worker().drain();
  await worker().drain();
  assert.equal(await status(job.id), 'UNKNOWN');
  assert.equal(deliveries.length, sentBefore + 1);
  job = await seed();
  outcome = { type: 'permanent', code: 'DEVICE_NOT_REGISTERED' };
  await worker().drain();
  assert.equal(await status(job.id), 'FAILED');
  assert.equal(
    (await registry.current(freshA, installationId)).registered,
    false,
  );
  pass(
    'definitive rejection backoff/max6, UNKNOWN never replayed, invalid token deactivated',
  );
  for (const attempted of [false, true]) {
    job = await seed();
    await source.query(
      "UPDATE push_delivery_outbox SET status='PROCESSING',lease_owner=$2,lease_until=now()-interval '1 minute',attempted_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE id=$1",
      [job.id, randomUUID(), attempted],
    );
    outcome = { type: 'ticket', ticketId: 'recovered' };
    await worker().drain();
    assert.equal(await status(job.id), attempted ? 'UNKNOWN' : 'TICKET');
  }
  pass('restart distinguishes unattempted lease from possibly accepted send');
  // Force overlapping workers while the first HTTPS call is paused.
  job = await seed();
  let started, release;
  const hasStarted = new Promise((r) => {
      started = r;
    }),
    gate = new Promise((r) => {
      release = r;
    });
  sendOverride = async () => {
    started();
    await gate;
    return { type: 'ticket', ticketId: 'concurrent' };
  };
  const first = worker().drain();
  await hasStarted;
  const at = deliveries.length;
  await worker().drain();
  assert.equal(deliveries.length, at);
  // Account disable must not wait for HTTPS; finish cannot resurrect cancelled work.
  await registry.update(freshA, false);
  release();
  await first;
  assert.equal(await status(job.id), 'CANCELLED');
  sendOverride = undefined;
  pass('two worker SKIP LOCKED ownership and disable during provider I/O');
  job = await seed();
  outcome = { type: 'ticket', ticketId: 'receipt-retry' };
  receipt = { type: 'retry', code: 'PROVIDER_UNAVAILABLE' };
  await worker().drain();
  const receiptSends = deliveries.length;
  await source.query('UPDATE push_delivery_outbox SET next_attempt_at=now()');
  await worker().drain();
  assert.equal(await status(job.id), 'TICKET');
  assert.equal(deliveries.length, receiptSends);
  receipt = { type: 'rejected', code: 'PROVIDER_UNAVAILABLE' };
  await source.query('UPDATE push_delivery_outbox SET next_attempt_at=now()');
  await worker().drain();
  assert.equal(await status(job.id), 'PENDING');
  assert.equal(deliveries.length, receiptSends);
  await source.query(
    'UPDATE push_delivery_outbox SET next_attempt_at=now(),attempted_at=NULL',
  );
  receipt = { type: 'accepted' };
  await worker().drain();
  assert.equal(deliveries.length, receiptSends + 1);
  job = await seed();
  await source.query(
    "UPDATE push_delivery_outbox SET expires_at=now()-interval '1 second'",
  );
  const beforeExpiry = deliveries.length;
  await worker().drain();
  assert.equal(await status(job.id), 'CANCELLED');
  assert.equal(deliveries.length, beforeExpiry);
  pass(
    'receipt lookup retry never resends; definitive message rejection resends within budget; TTL cancels',
  );
  // Uppercase UUID aliases must share locks, storage and authenticated cipher AAD.
  await source.query('DELETE FROM push_delivery_outbox');
  await registry.register(freshA, {
    ...rotated,
    installationId: installationId.toUpperCase(),
    projectId: rotated.projectId.toUpperCase(),
  });
  await record();
  job = (await source.query('SELECT * FROM push_delivery_outbox'))[0];
  await worker().drain();
  assert.equal(await status(job.id), 'TICKET');
  const notYetRegistered = randomUUID();
  await registry.remove(freshA, notYetRegistered);
  await assert.rejects(
    () =>
      registry.register(freshA, {
        ...rotated,
        installationId: notYetRegistered,
        expoPushToken: 'ExpoPushToken[delayedabcdefghijkl]',
      }),
    (e) => e.getStatus() === 409,
  );
  await registry.remove(freshA, installationId);
  await assert.rejects(
    () => registry.register(freshA, rotated),
    (e) => e.getStatus() === 409,
  );
  // Fresh authentication, not a stale GET, is the recovery boundary for revoked enrollment.
  freshA.expiresAt += 120_000;
  await registry.register(freshA, rotated);
  pass(
    'canonical UUID routing and durable logout fence reject delayed POST even before first enrollment',
  );
  const scratch = {
    ...rotated,
    installationId: randomUUID(),
    expoPushToken: 'ExpoPushToken[scratchabcdefghijkl]',
  };
  await registry.register(freshA, scratch);
  await registry.remove(freshA, scratch.installationId);
  await registry.register(B, {
    ...scratch,
    expoPushToken: 'ExpoPushToken[scratchrotatedabcdef]',
  });
  assert.equal(
    (await registry.current(B, scratch.installationId)).eligible,
    true,
  );
  // Expired active markers cannot consume quota or permit a 21st live renewal.
  const historical = [];
  for (let i = 0; i < 20; i++) {
    const id = randomUUID();
    historical.push(id);
    await source.query(
      `INSERT INTO push_devices(user_id,installation_id,token_fingerprint,encrypted_token,platform,app_environment,project_id,active,auth_version,session_expires_at,enrollment_revision,lease_until)
      VALUES ($1,$2,$3,'v1.test','ios','development',$4,true,0,now()+interval '1 hour',$5,now()-interval '1 second')`,
      [
        b.id,
        id,
        randomBytes(32).toString('hex'),
        input.projectId,
        randomUUID(),
      ],
    );
  }
  await registry.register(B, {
    ...input,
    installationId: randomUUID(),
    expoPushToken: 'ExpoPushToken[quotaabcdefghijklmn]',
  });
  await source.query(
    "UPDATE push_devices SET lease_until=now()+interval '1 hour' WHERE installation_id=ANY($1::uuid[])",
    [historical.slice(1, 19)],
  );
  await assert.rejects(
    () =>
      registry.register(B, {
        ...input,
        installationId: historical[0],
        expoPushToken: 'ExpoPushToken[renewabcdefghijklmn]',
      }),
    (e) => e.getStatus() === 429,
  );
  pass(
    'live foreign credential protected, revoked rotation transferable and expired device quota bounded',
  );
  // Valid invitations intentionally have no direct resource target/proof.
  const invitationResolvers = new NotificationInvitationResolvers();
  const {
    WorkspaceInvitationNotificationResolver,
  } = require('../../dist/api/workspaces/workspace-invitation-notification-resolver.js');
  const invitationResolver = new WorkspaceInvitationNotificationResolver(
    invitationResolvers,
  );
  const [team] = await source.query(
    "INSERT INTO workspaces(type,name,created_by_id) VALUES ('TEAM','Private team',$1) RETURNING id",
    [b.id],
  );
  const [invitation] = await source.query(
    "INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,expires_at,invited_by_id,send_state) VALUES ($1,'a@push.test','MEMBER',$2,now()+interval '1 day',$3,'SENT') RETURNING id",
    [team.id, randomBytes(32).toString('hex'), b.id],
  );
  const inviteWorker = () =>
    new PushDispatcher(
      source,
      config,
      provider,
      new NotificationResolver(invitationResolvers),
    );
  await source.query('DELETE FROM push_delivery_outbox');
  await source.transaction((m) =>
    recorder.record(m, {
      kind: 'WORKSPACE_INVITED',
      recipientUserId: a.id,
      workspaceId: team.id,
      occurrenceKey: invitation.id,
    }),
  );
  job = (await source.query('SELECT * FROM push_delivery_outbox'))[0];
  await inviteWorker().drain();
  assert.equal(await status(job.id), 'TICKET');
  await source.query('DELETE FROM push_delivery_outbox');
  await source.query(
    'UPDATE workspace_invitations SET revoked_at=clock_timestamp() WHERE id=$1',
    [invitation.id],
  );
  const [revokedInvite] = await source.query(
    "INSERT INTO workspace_invitations(workspace_id,email,role,token_hash,expires_at,invited_by_id,send_state) VALUES ($1,'a@push.test','MEMBER',$2,now()+interval '1 day',$3,'SENT') RETURNING id",
    [team.id, randomBytes(32).toString('hex'), b.id],
  );
  await source.transaction((m) =>
    recorder.record(m, {
      kind: 'WORKSPACE_INVITED',
      recipientUserId: a.id,
      workspaceId: team.id,
      occurrenceKey: revokedInvite.id,
    }),
  );
  job = (await source.query('SELECT * FROM push_delivery_outbox'))[0];
  const revokeLock = source.createQueryRunner();
  await revokeLock.connect();
  await revokeLock.startTransaction();
  try {
    await revokeLock.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [
      team.id,
    ]);
    await revokeLock.query(
      'UPDATE workspace_invitations SET revoked_at=clock_timestamp() WHERE id=$1',
      [revokedInvite.id],
    );
    const draining = inviteWorker().drain();
    let blocked = false;
    for (let i = 0; i < 100 && !blocked; i++) {
      [{ blocked }] = await source.query(
        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM workspaces%') AS blocked",
      );
      if (!blocked) await delay(10);
    }
    assert(blocked);
    await revokeLock.commitTransaction();
    await draining;
  } finally {
    if (revokeLock.isTransactionActive) await revokeLock.rollbackTransaction();
    await revokeLock.release();
  }
  assert.equal(await status(job.id), 'CANCELLED');
  invitationResolver.onModuleDestroy();
  pass(
    'authorized Workspace invitation with target:null sends only Inbox-safe push',
  );
  // Board/Card notifications carry boardId, not workspaceId. A concurrent
  // Workspace revocation must block preparation before its fresh ACL check.
  job = await seed();
  const beforeMembershipRevoke = deliveries.length;
  await source.query(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,'MEMBER')",
    [team.id, a.id],
  );
  await source.query(
    "UPDATE boards SET workspace_id=$2,visibility='WORKSPACE_VISIBLE' WHERE id=$1",
    [board.id, team.id],
  );
  await source.query(
    'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
    [board.id, a.id],
  );
  const membershipLock = source.createQueryRunner();
  await membershipLock.connect();
  await membershipLock.startTransaction();
  let revokedMembership;
  try {
    [revokedMembership] = await membershipLock.query(
      'SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE',
      [team.id, a.id],
    );
    assert.ok(revokedMembership);
    await membershipLock.query(
      'DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
      [team.id, a.id],
    );
    const draining = worker().drain();
    let blocked = false;
    for (let i = 0; i < 100 && !blocked; i++) {
      [{ blocked }] = await source.query(
        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT wm.user_id FROM workspace_members%') AS blocked",
      );
      if (!blocked) await delay(10);
    }
    assert.ok(
      blocked,
      'Board job must wait for Workspace membership revocation',
    );
    assert.equal(deliveries.length, beforeMembershipRevoke);
    await membershipLock.commitTransaction();
    await draining;
  } finally {
    if (membershipLock.isTransactionActive)
      await membershipLock.rollbackTransaction();
    await membershipLock.release();
  }
  assert.equal(await status(job.id), 'CANCELLED');
  assert.equal(deliveries.length, beforeMembershipRevoke);
  await source.query(
    'INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ($1,$2,$3)',
    [team.id, a.id, revokedMembership.role],
  );
  await source.query(
    "UPDATE boards SET workspace_id=$2,visibility='PRIVATE' WHERE id=$1",
    [board.id, board.workspace_id],
  );
  await source.query(
    "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')",
    [board.id, a.id],
  );
  pass(
    'Board job waits for concurrent Workspace membership revoke and cancels before provider I/O',
  );
  for (const change of [
    'preference',
    'archive',
    'membership',
    'session',
    'permission-lease',
    'delete-card',
  ]) {
    job = await seed();
    outcome = { type: 'ticket', ticketId: 'must-not-send' };
    const beforeSend = deliveries.length;
    if (change === 'preference')
      await source.query(
        'UPDATE notification_preferences SET in_app_card_assigned=false WHERE user_id=$1',
        [a.id],
      );
    if (change === 'archive')
      await source.query('UPDATE boards SET is_archived=true WHERE id=$1', [
        board.id,
      ]);
    if (change === 'membership')
      await source.query(
        'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
        [board.id, a.id],
      );
    if (change === 'session')
      await source.query('UPDATE users SET auth_version=1 WHERE id=$1', [a.id]);
    if (change === 'permission-lease')
      await source.query(
        "UPDATE push_devices SET lease_until=now()-interval '1 second' WHERE user_id=$1",
        [a.id],
      );
    if (change === 'delete-card')
      await source.query('DELETE FROM cards WHERE id=$1', [card.id]);
    await worker().drain();
    assert.equal(await status(job.id), 'CANCELLED', change);
    assert.equal(deliveries.length, beforeSend, change);
    await source.query(
      'UPDATE notification_preferences SET in_app_card_assigned=true WHERE user_id=$1',
      [a.id],
    );
    await source.query('UPDATE boards SET is_archived=false WHERE id=$1', [
      board.id,
    ]);
    await source.query(
      "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER') ON CONFLICT DO NOTHING",
      [board.id, a.id],
    );
    await source.query('UPDATE users SET auth_version=0 WHERE id=$1', [a.id]);
  }
  pass(
    'send-time preference, archived Board, revoked membership, invalid session, OS lease, deleted Card',
  );
  // Explicit account cleanup order is exercised with the real soft-deletion helper.
  const {
    eraseAccountPrivateState,
  } = require('../../dist/api/users/account-deletion/account-deletion-state.js');
  await source.query('DELETE FROM boards WHERE id=$1', [board.id]);
  await source.query('DELETE FROM board_members WHERE user_id=$1', [a.id]);
  const { User } = require('../../dist/api/users/entities/user.entity.js');
  await source.transaction(async (m) =>
    eraseAccountPrivateState(
      m,
      await m.getRepository(User).findOneByOrFail({ id: a.id }),
    ),
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM push_devices WHERE user_id=$1',
        [a.id],
      )
    )[0].n,
    0,
  );
  assert.equal(await count('push_delivery_outbox'), 0);
  pass('account deletion erases routing devices and outbox before Inbox FKs');
  console.log('Push PostgreSQL integration: ' + groups + ' groups passed');
} finally {
  await source?.destroy();
  if (created) await admin.query('DROP DATABASE "' + name + '" WITH (FORCE)');
  await admin.end();
}
