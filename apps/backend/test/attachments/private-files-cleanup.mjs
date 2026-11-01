import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  AttachmentCleanupService,
} = require('../../dist/api/cards/attachments/attachment-cleanup.service.js');
const { Board } = require('../../dist/api/boards/entities/board.entity.js');
const { ConfigService } = require('@nestjs/config');

export async function verifyPrivateFileCleanup(ctx) {
  const {
    source,
    app,
    storage,
    actors,
    board,
    card,
    begin,
    transfer,
    send,
    attachments,
    activeFile,
    pass,
  } = ctx;
  const worker = app.get(AttachmentCleanupService);
  const due = async (id) =>
    source.query(
      "UPDATE card_attachment_cleanup_jobs SET not_before=now()-interval '2 hours',next_attempt_at=now()-interval '1 minute' WHERE attachment_id=$1",
      [id],
    );
  const insert = async (
    id,
    created = "now()-interval '2 hours'",
    expires = "now()-interval '1 hour'",
  ) =>
    source.query(
      `INSERT INTO card_attachments(id,card_id,board_id,uploader_id,kind,state,display_name,original_filename,pending_key,storage_key,requested_mime_type,reserved_bytes,declared_bytes,intent_auth_version,created_at,expires_at)
    VALUES($1::uuid,$2,$3,$4,'FILE','PENDING','Expired','expired.txt','attachments/v1/pending/'||$1::text,'attachments/v1/active/'||$1::text,'text/plain',5,5,0,${created},${expires})`,
      [id, card.id, board.id, actors.owner],
    );
  const expired = randomUUID();
  await insert(expired);
  const expiredKey = `attachments/v1/pending/${expired}`;
  storage.objects.set(expiredKey, {
    body: Buffer.from('hello'),
    contentType: 'text/plain',
  });
  const beforeExpiry = await source.query(
    'SELECT expires_at::text FROM card_attachments WHERE id=$1',
    [expired],
  );
  await worker.sweep();
  assert.deepEqual(
    await source.query(
      'SELECT expires_at::text FROM card_attachments WHERE id=$1',
      [expired],
    ),
    beforeExpiry,
  );
  assert.equal(
    (
      await source.query('SELECT state FROM card_attachments WHERE id=$1', [
        expired,
      ])
    )[0].state,
    'EXPIRED',
  );
  assert.ok(storage.objects.has(expiredKey));
  await due(expired);
  await due(activeFile.id);
  const pending = await begin();
  await transfer(pending).expect(204);
  await due(pending.uploadId);
  const pendingKey = `attachments/v1/pending/${pending.uploadId}`,
    activeKey = `attachments/v1/active/${activeFile.id}`;
  const remove = storage.delete.bind(storage),
    calls = [];
  storage.delete = async (key) => {
    const [row] = await source.query(
      "SELECT count(*)::int AS n FROM card_attachments WHERE kind='FILE' AND ((state='PENDING' AND (pending_key=$1 OR storage_key=$1)) OR (state='ACTIVE' AND storage_key=$1))",
      [key],
    );
    assert.equal(row.n, 0, 'Cleanup attempted a referenced object');
    calls.push(key);
    await remove(key);
  };
  try {
    await worker.sweep();
  } finally {
    storage.delete = remove;
  }
  assert.ok(!storage.objects.has(expiredKey));
  assert.ok(storage.objects.has(pendingKey));
  assert.ok(storage.objects.has(activeKey));
  assert.ok(!calls.includes(activeKey));
  await send(
    'owner',
    'get',
    attachments + '/' + activeFile.id + '/file',
  ).expect(200);
  const expiredJobs = await source.query(
    'SELECT * FROM card_attachment_cleanup_jobs WHERE attachment_id=$1',
    [expired],
  );
  assert.equal(expiredJobs.length, 2);
  assert.ok(expiredJobs.every((row) => row.completed_at && row.attempts > 0));
  pass(
    'durable sweeps expire abandoned intents, respect grace, delete unreferenced keys and preserve both PENDING and ACTIVE references',
  );

  const canceled = await begin();
  await transfer(canceled).expect(204);
  await send(
    'owner',
    'delete',
    attachments + '/uploads/' + canceled.uploadId,
  ).expect(204);
  await due(canceled.uploadId);
  const canceledKey = `attachments/v1/pending/${canceled.uploadId}`;
  storage.delete = async () => {
    throw new Error('Injected storage outage; no secrets logged');
  };
  try {
    await worker.sweep();
  } finally {
    storage.delete = remove;
  }
  assert.ok(storage.objects.has(canceledKey));
  const failed = await source.query(
    'SELECT * FROM card_attachment_cleanup_jobs WHERE attachment_id=$1',
    [canceled.uploadId],
  );
  assert.ok(failed.some((row) => row.attempts > 0 && !row.completed_at));
  const restarted = new AttachmentCleanupService(
    source.getRepository(Board),
    storage,
    app.get(ConfigService),
  );
  await due(canceled.uploadId);
  await restarted.sweep();
  assert.ok(!storage.objects.has(canceledKey));
  // A late write after an ambiguous successful provider delete is still reconciled.
  storage.objects.set(canceledKey, {
    body: Buffer.from('hello'),
    contentType: 'text/plain',
  });
  await due(canceled.uploadId);
  await restarted.sweep();
  assert.ok(!storage.objects.has(canceledKey));
  // Simulate an expired worker claim after a crash; persisted lease/counter is reclaimed.
  await source.query(
    "UPDATE card_attachment_cleanup_jobs SET completed_at=NULL,attempts=attempts+1,next_attempt_at=now()-interval '1 second' WHERE object_key=$1",
    [canceledKey],
  );
  await restarted.sweep();
  assert.ok(
    (
      await source.query(
        'SELECT completed_at FROM card_attachment_cleanup_jobs WHERE object_key=$1',
        [canceledKey],
      )
    )[0].completed_at,
  );
  await source.query('DELETE FROM card_attachments WHERE id=$1', [
    canceled.uploadId,
  ]);
  await assert.rejects(
    insert(canceled.uploadId, 'now()', "now()+interval '15 minutes'"),
    (error) => error.driverError?.code === '23505',
  );
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int AS n FROM card_attachments WHERE id=$1',
        [canceled.uploadId],
      )
    )[0].n,
    0,
  );
  pass(
    'cleanup provider failure, restarted worker, lost acknowledgement/late write and expired claim recover from durable records; deleted FILE identity cannot be reused',
  );
  await restarted.onModuleDestroy();
}
