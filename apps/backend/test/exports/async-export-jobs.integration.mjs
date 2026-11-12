import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import process from 'node:process';
assert.equal(process.env.EXPORT_DATABASE_TESTS, 'local-only');
assert.equal(process.env.DATABASE_HOST, '127.0.0.1');
assert.equal(process.env.DATABASE_PORT, '55454');
assert.equal(process.env.DATABASE_NAME, 'vt054_test');
assert.notEqual(process.env.NODE_ENV, 'production');
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { databaseOptions } = require('../../dist/database/database-options.js');
const { ExportSnapshot } = require('../../dist/api/exports/export-snapshot.js');
const {
  BoardExportService,
} = require('../../dist/api/exports/board-export.service.js');
const {
  ExportJobsService,
} = require('../../dist/api/exports/export-jobs.service.js');
const {
  eraseAccountPrivateState,
} = require('../../dist/api/users/account-deletion/account-deletion-state.js');
const options = databaseOptions(process.env);
const admin = new Client({ ...options, user: options.username });
const database = `vt054_jobs_${randomBytes(8).toString('hex')}`;
let source,
  created = false,
  groups = 0;
const pass = (label) => {
  groups++;
  console.log(`PASS ${label}`);
};
const rejectsStatus = (promise, status) =>
  assert.rejects(promise, (error) => error.getStatus?.() === status);
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  source = await new DataSource({ ...options, database }).initialize();
  await source.runMigrations();
  const [user] = await source.query(
    "INSERT INTO users(email,display_name,email_verified_at) VALUES ('owner@vt054.test','Owner',now()) RETURNING *",
  );
  const [other] = await source.query(
    "INSERT INTO users(email,display_name,email_verified_at) VALUES ('other@vt054.test','Other',now()) RETURNING *",
  );
  const [workspace] = await source.query(
    "INSERT INTO workspaces(type,name,created_by_id) VALUES ('TEAM','Async tests',$1) RETURNING id",
    [user.id],
  );
  const [board] = await source.query(
    "INSERT INTO boards(name,created_by_id,workspace_id) VALUES ('Async tests',$1,$2) RETURNING id",
    [user.id, workspace.id],
  );
  for (const id of [user.id, other.id])
    await source.query(
      "INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'OWNER')",
      [board.id, id],
    );
  const actor = {
    userId: user.id,
    authVersion: user.auth_version,
    expiresAt: Date.now() + 3_600_000,
  };
  const snapshots = new ExportSnapshot(source);
  const boards = new BoardExportService(snapshots);
  const jobs = new ExportJobsService(source, boards, snapshots);
  const key = randomUUID();
  const replies = await Promise.all(
    Array.from({ length: 120 }, () => jobs.start(actor, board.id, key, 'json')),
  );
  const id = replies[0].id;
  assert.equal(new Set(replies.map((row) => row.id)).size, 1);
  assert.ok(
    replies.every((row) => row.state === 'PENDING' && row.progress === 0),
  );
  const [{ count }] = await source.query(
    'SELECT count(*)::int AS count FROM board_export_jobs',
  );
  assert.equal(count, 1);
  pass('TC01/02/03: 120 concurrent retries create one durable pending job');
  await rejectsStatus(jobs.start(actor, board.id, key, 'csv'), 409);
  await rejectsStatus(jobs.start(actor, board.id, 'bad-key', 'json'), 400);
  await rejectsStatus(
    jobs.status({ ...actor, userId: other.id }, board.id, id),
    404,
  );
  await rejectsStatus(
    jobs.status({ ...actor, authVersion: 999 }, board.id, id),
    401,
  );
  await rejectsStatus(jobs.download(actor, board.id, id), 409);
  pass(
    'TC04/05/06/07/08: conflict, invalid key, job isolation, invalid session and not-ready download',
  );
  const claims = await Promise.all(
    Array.from({ length: 4 }, () => jobs.processNext()),
  );
  assert.equal(claims.filter(Boolean).length, 1);
  const done = await jobs.status(actor, board.id, id);
  assert.equal(done.state, 'COMPLETED');
  assert.equal(done.progress, 100);
  assert.equal(done.attempts, 1);
  assert.deepEqual(
    Object.keys(done).sort(),
    [
      'id',
      'state',
      'format',
      'attempts',
      'expiresAt',
      'progress',
      'error',
    ].sort(),
  );
  const result = await jobs.download(actor, board.id, id);
  assert.equal(JSON.parse(result.body.toString()).board.id, board.id);
  await jobs.start(actor, board.id, key, 'json');
  await jobs.retry(actor, board.id, id);
  assert.equal(await jobs.processNext(), false);
  assert.equal((await jobs.status(actor, board.id, id)).attempts, 1);
  pass(
    'TC09/12: one claim, exact completed projection and real JSON; replay never regenerates',
  );
  const original = boards.create.bind(boards);
  boards.create = async () => {
    throw new Error('SELECT private secret');
  };
  const failure = await jobs.start(actor, board.id, randomUUID(), 'json');
  await jobs.processNext();
  const failed = await jobs.status(actor, board.id, failure.id);
  assert.equal(failed.state, 'FAILED');
  assert.equal(failed.error, 'EXPORT_FAILED');
  assert.ok(!JSON.stringify(failed).includes('secret'));
  await Promise.all(
    Array.from({ length: 120 }, () => jobs.retry(actor, board.id, failure.id)),
  );
  boards.create = original;
  await jobs.processNext();
  assert.equal((await jobs.status(actor, board.id, failure.id)).attempts, 2);
  pass(
    'TC10: sanitized failure, 120 retries reuse same job and one new attempt',
  );
  // Controlled latch: stale completion must not overwrite the second lease's bytes.
  let release, entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  boards.create = async () => {
    entered();
    await blocked;
    return Buffer.from('stale');
  };
  const recovering = await jobs.start(actor, board.id, randomUUID(), 'json');
  const oldWorker = jobs.processNext();
  await started;
  await source.query(
    "UPDATE board_export_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
    [recovering.id],
  );
  boards.create = async () => Buffer.from('recovered');
  await jobs.processNext();
  release();
  await oldWorker;
  assert.equal(
    (await jobs.download(actor, board.id, recovering.id)).body.toString(),
    'recovered',
  );
  assert.equal((await jobs.status(actor, board.id, recovering.id)).attempts, 2);
  pass(
    'TC11: expired lease recovered; stale attempt cannot overwrite current result',
  );
  boards.create = original;
  await source.query(
    "UPDATE board_members SET role='MEMBER' WHERE board_id=$1 AND user_id=$2",
    [board.id, user.id],
  );
  await rejectsStatus(jobs.download(actor, board.id, id), 403);
  await source.query(
    "UPDATE board_members SET role='OWNER' WHERE board_id=$1 AND user_id=$2",
    [board.id, user.id],
  );
  await source.query(
    "UPDATE board_export_jobs SET created_at=now()-interval '20 minutes',expires_at=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  await rejectsStatus(jobs.download(actor, board.id, id), 410);
  await jobs.sweep();
  const [expired] = await source.query(
    'SELECT body FROM board_export_jobs WHERE id=$1',
    [id],
  );
  assert.equal(expired.body, null);
  pass('TC13: fresh owner revocation, result TTL and expired-byte cleanup');
  await source.transaction((manager) =>
    eraseAccountPrivateState(manager, user),
  );
  const [{ retained }] = await source.query(
    'SELECT count(*)::int AS retained FROM board_export_jobs WHERE user_id=$1',
    [user.id],
  );
  assert.equal(retained, 0, 'account erasure must remove private export jobs');
  pass(
    'AC3 security regression: account erasure removes job bytes and identity keys',
  );
  console.log(`Async export PostgreSQL suite: ${groups} groups passed`);
} finally {
  if (source?.isInitialized) await source.destroy();
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
