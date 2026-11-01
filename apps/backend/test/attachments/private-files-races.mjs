import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout, clearTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
const require = createRequire(import.meta.url);
const {
  CardAttachmentFilesService,
} = require('../../dist/api/cards/card-attachment-files.service.js');
const {
  AttachmentContentService,
} = require('../../dist/api/cards/attachments/attachment-content.service.js');
const {
  BoardAuthorizationService,
} = require('../../dist/api/board-members/board-authorization.service.js');
const {
  BoardEventPublisher,
} = require('../../dist/realtime/board-event-publisher.service.js');
const { Board } = require('../../dist/api/boards/entities/board.entity.js');
const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const outcome = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );

export async function verifyPrivateFileRaces(ctx) {
  const {
    source,
    app,
    files,
    service,
    storage,
    cards,
    members,
    actors,
    tokens,
    actor,
    board,
    card,
    createCard,
    send,
    pass,
  } = ctx;
  const input = {
    filename: 'race.txt',
    contentType: 'text/plain',
    fileSize: 5,
  };
  const ready = async (label, who = 'owner') => {
    const target = await createCard(label),
      key = randomUUID();
    const intent = await files.createIntent(
      actor(who),
      board.id,
      target.id,
      input,
      key,
    );
    await files.receiveLocal(
      actor(who),
      board.id,
      target.id,
      intent.uploadId,
      Buffer.from('hello'),
      'text/plain',
    );
    return {
      target,
      intent,
      key,
      who,
      complete: () =>
        files.complete(actor(who), board.id, target.id, intent.uploadId),
    };
  };
  const pauseRead = async (key, operation, during) => {
    const entered = deferred(),
      release = deferred(),
      read = storage.read.bind(storage);
    storage.read = async (k, max) => {
      const object = await read(k, max);
      if (k === key) {
        entered.resolve();
        await release.promise;
      }
      return object;
    };
    const task = outcome(operation());
    let timer;
    try {
      await Promise.race([
        entered.promise,
        task.then((result) => {
          throw result.error ?? new Error('Storage gate not reached');
        }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Storage gate timeout')),
            5000,
          );
        }),
      ]);
      await during();
    } finally {
      clearTimeout(timer);
      release.resolve();
      storage.read = read;
    }
    return task;
  };
  const race = async (boardId, first, second) => {
    const runner = source.createQueryRunner(),
      tasks = [];
    const waiters = async (count) => {
      const end = Date.now() + 5000;
      while (Date.now() < end) {
        const [row] = await source.query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",
        );
        if (row.n >= count) return;
        await delay(10);
      }
      throw new Error('Missing PostgreSQL lock waiters');
    };
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query('SELECT id FROM boards WHERE id=$1 FOR UPDATE', [
        boardId,
      ]);
      tasks.push(outcome(first()));
      await waiters(1);
      tasks.push(outcome(second()));
      await waiters(2);
      await runner.commitTransaction();
      return await Promise.all(tasks);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await Promise.all(tasks);
      await runner.release();
    }
  };
  const duplicateKey = randomUUID();
  const same = await race(
    board.id,
    () => files.createIntent(actor(), board.id, card.id, input, duplicateKey),
    () => files.createIntent(actor(), board.id, card.id, input, duplicateKey),
  );
  assert.ok(same.every((result) => result.value));
  assert.equal(same[0].value.uploadId, same[1].value.uploadId);
  const slots = await createCard('Slot races');
  for (let i = 0; i < 19; i++)
    await files.createIntent(actor(), board.id, slots.id, input, randomUUID());
  const slotRace = await race(
    board.id,
    () => files.createIntent(actor(), board.id, slots.id, input, randomUUID()),
    () => files.createIntent(actor(), board.id, slots.id, input, randomUUID()),
  );
  assert.ok(slotRace[0].value);
  assert.equal(slotRace[1].error.getStatus(), 409);
  const quotaBoard = (
    await send('owner', 'post', '/api/boards')
      .send({ name: 'Byte quota' })
      .expect(201)
  ).body.data;
  const quotaColumn = (
    await send('owner', 'post', `/api/boards/${quotaBoard.id}/columns`)
      .send({ name: 'Quota' })
      .expect(201)
  ).body.data;
  const quotaCard = await cards.create(actors.owner, quotaBoard.id, {
    title: 'Quota',
    columnId: quotaColumn.id,
  });
  const imageInput = {
    filename: 'photo.png',
    contentType: 'image/png',
    fileSize: 100,
  };
  const reserve = () =>
    files.createIntent(
      actor(),
      quotaBoard.id,
      quotaCard.id,
      imageInput,
      randomUUID(),
    );
  for (let i = 0; i < 9; i++) await reserve();
  const byteRace = await race(quotaBoard.id, reserve, reserve);
  assert.ok(byteRace[0].value);
  assert.equal(byteRace[1].error.getStatus(), 409);
  await files.cancel(
    actor(),
    quotaBoard.id,
    quotaCard.id,
    byteRace[0].value.uploadId,
  );
  await reserve();
  assert.equal(
    (
      await ctx.attachmentQuotaUsage(
        source.manager,
        quotaBoard.id,
        quotaCard.id,
      )
    ).boardFileBytes,
    100n * 1024n * 1024n,
  );
  pass(
    'observed Board locks serialize idempotent intents and concurrent Card-slot/Board-byte reservations without oversubscription',
  );

  const double = await ready('Double completion');
  const completed = await pauseRead(
    `attachments/v1/pending/${double.intent.uploadId}`,
    double.complete,
    async () => {
      const runner = source.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(
          'SELECT id FROM boards WHERE id=$1 FOR UPDATE NOWAIT',
          [board.id],
        );
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
      await assert.rejects(
        double.complete(),
        (error) => error.getStatus() === 409,
      );
      assert.equal(
        (
          await source.query('SELECT state FROM card_attachments WHERE id=$1', [
            double.intent.uploadId,
          ])
        )[0].state,
        'PENDING',
      );
    },
  );
  assert.ok(completed.value);
  assert.equal(completed.value.state, 'ACTIVE');
  assert.deepEqual(await double.complete(), completed.value);
  pass(
    'two completions share one immutable ACTIVE object; provider I/O holds no Board transaction and active retries are silent',
  );

  const parallel = await Promise.all(
    ['A', 'B', 'C'].map((name) => ready('Processor ' + name)),
  );
  const readParallel = storage.read.bind(storage),
    enteredParallel = deferred(),
    releaseParallel = deferred();
  let atRead = 0;
  const held = new Set(
    parallel
      .slice(0, 2)
      .map((item) => `attachments/v1/pending/${item.intent.uploadId}`),
  );
  storage.read = async (key, max) => {
    const object = await readParallel(key, max);
    if (held.has(key)) {
      if (++atRead === 2) enteredParallel.resolve();
      await releaseParallel.promise;
    }
    return object;
  };
  const firstParallel = parallel
    .slice(0, 2)
    .map((item) => outcome(item.complete()));
  let processorTimer;
  try {
    await Promise.race([
      enteredParallel.promise,
      new Promise((_, reject) => {
        processorTimer = setTimeout(
          () => reject(new Error('Processor gate timeout')),
          5000,
        );
      }),
    ]);
    await assert.rejects(
      parallel[2].complete(),
      (error) => error.getStatus() === 503,
    );
  } finally {
    clearTimeout(processorTimer);
    releaseParallel.resolve();
    storage.read = readParallel;
  }
  assert.ok((await Promise.all(firstParallel)).every((result) => result.value));
  await parallel[2].complete();
  pass(
    'per-process completion pressure is bounded before reading bytes and rejected work retries without a leaked lease',
  );

  const canceled = await ready('Cancel during verification');
  const canceledResult = await pauseRead(
    `attachments/v1/pending/${canceled.intent.uploadId}`,
    canceled.complete,
    () =>
      files.cancel(
        actor(),
        board.id,
        canceled.target.id,
        canceled.intent.uploadId,
      ),
  );
  assert.equal(canceledResult.error.getStatus(), 409);
  assert.equal(
    (
      await source.query('SELECT state FROM card_attachments WHERE id=$1', [
        canceled.intent.uploadId,
      ])
    )[0].state,
    'REMOVED',
  );
  const archived = await ready('Archive during verification');
  const archiveResult = await pauseRead(
    `attachments/v1/pending/${archived.intent.uploadId}`,
    archived.complete,
    () => cards.archive(actors.owner, board.id, archived.target.id),
  );
  assert.equal(archiveResult.error.getStatus(), 409);
  assert.equal(
    (
      await source.query('SELECT state FROM card_attachments WHERE id=$1', [
        archived.intent.uploadId,
      ])
    )[0].state,
    'PENDING',
  );
  await cards.restore(actors.owner, board.id, archived.target.id);
  const boardArchive = await ready('Board archive during verification');
  const boardArchiveResult = await pauseRead(
    `attachments/v1/pending/${boardArchive.intent.uploadId}`,
    boardArchive.complete,
    async () => {
      await send('owner', 'post', `/api/boards/${board.id}/archive`).expect(
        200,
      );
      await send(
        'owner',
        'get',
        `/api/boards/${board.id}/cards/${double.target.id}/attachments/${completed.value.id}/file`,
      ).expect(200);
    },
  );
  assert.equal(boardArchiveResult.error.getStatus(), 409);
  await send('owner', 'post', `/api/boards/${board.id}/restore`).expect(200);
  const addActor = async (name) => {
    const [user] = await source.query(
      'INSERT INTO users(email,display_name,email_verified_at) VALUES($1,$1,now()) RETURNING id',
      [name + '@private-files.test'],
    );
    actors[name] = user.id;
    tokens[name] = await app.get(JwtService).signAsync({ sub: user.id });
    await source.query(
      "INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'MEMBER')",
      [board.id, user.id],
    );
  };
  await addActor('revoked');
  const revoked = await ready('Revoked during verification', 'revoked');
  const revokedResult = await pauseRead(
    `attachments/v1/pending/${revoked.intent.uploadId}`,
    revoked.complete,
    () => members.remove(actors.owner, board.id, actors.revoked),
  );
  assert.equal(revokedResult.error.getStatus(), 404);
  await addActor('invalidated');
  const invalidated = await ready(
    'Session invalidation during verification',
    'invalidated',
  );
  const invalidResult = await pauseRead(
    `attachments/v1/pending/${invalidated.intent.uploadId}`,
    invalidated.complete,
    () =>
      source.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [
        actors.invalidated,
      ]),
  );
  assert.equal(invalidResult.error.getStatus(), 401);
  pass(
    'cancel, Card archive, membership revocation and session invalidation during verification cannot publish or resurrect file pointers',
  );

  const readTarget = await ready('Read ACL recheck');
  const readable = await readTarget.complete();
  await send('owner', 'patch', `/api/boards/${board.id}/visibility`)
    .send({ visibility: 'WORKSPACE_VISIBLE' })
    .expect(200);
  let canceledStream = false;
  const read = storage.read.bind(storage);
  storage.read = async (k, max) => {
    const object = await read(k, max),
      cancel = object.cancel;
    return {
      ...object,
      cancel: () => {
        canceledStream = true;
        cancel?.();
      },
    };
  };
  try {
    const denied = await pauseRead(
      `attachments/v1/active/${readable.id}`,
      () =>
        send(
          'viewer',
          'get',
          `/api/boards/${board.id}/cards/${readTarget.target.id}/attachments/${readable.id}/file`,
        ).then((response) => response),
      () =>
        send('owner', 'patch', `/api/boards/${board.id}/visibility`)
          .send({ visibility: 'PRIVATE' })
          .expect(200),
    );
    assert.equal(denied.value.status, 404);
    assert.equal(canceledStream, true);
  } finally {
    storage.read = read;
  }
  const deleted = await pauseRead(
    `attachments/v1/active/${readable.id}`,
    () => files.download(actor(), board.id, readTarget.target.id, readable.id),
    () =>
      service.remove(actors.owner, board.id, readTarget.target.id, readable.id),
  );
  assert.equal(deleted.error.getStatus(), 404);
  await send('owner', 'patch', `/api/boards/${board.id}/visibility`)
    .send({ visibility: 'WORKSPACE_VISIBLE' })
    .expect(200);
  pass(
    'real authenticated downloads recheck visibility and current ACTIVE association after storage I/O and cancel denied streams',
  );

  await addActor('downloadInvalidated');
  const sessionRead = await ready(
      'Download session recheck',
      'downloadInvalidated',
    ),
    sessionFile = await sessionRead.complete();
  const sessionDenied = await pauseRead(
    `attachments/v1/active/${sessionFile.id}`,
    () =>
      send(
        'downloadInvalidated',
        'get',
        `/api/boards/${board.id}/cards/${sessionRead.target.id}/attachments/${sessionFile.id}/file`,
      ).then((response) => response),
    () =>
      source.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [
        actors.downloadInvalidated,
      ]),
  );
  assert.equal(sessionDenied.value.status, 401);
  const expiredSession = await ready('Expired session');
  await assert.rejects(
    files.complete(
      { ...actor(), expiresAt: Date.now() - 1 },
      board.id,
      expiredSession.target.id,
      expiredSession.intent.uploadId,
    ),
    (error) => error.getStatus() === 401,
  );
  await assert.rejects(
    source.query(
      'UPDATE card_attachments SET declared_bytes=declared_bytes+1,revision=revision+1 WHERE id=$1',
      [expiredSession.intent.uploadId],
    ),
    (error) => error.driverError?.code === '23514',
  );
  await assert.rejects(
    source.query(
      "UPDATE card_attachments SET verification_token=$2,verification_expires_at=expires_at+interval '1 minute',revision=revision+1 WHERE id=$1",
      [expiredSession.intent.uploadId, randomUUID()],
    ),
    (error) => error.driverError?.code === '23514',
  );
  const [removedRecord] = await source.query(
    "SELECT id FROM card_attachments WHERE kind='FILE' AND state='REMOVED' AND content_sha256 IS NOT NULL LIMIT 1",
  );
  await assert.rejects(
    source.query(
      "UPDATE card_attachments SET state='ACTIVE',revision=revision+1 WHERE id=$1",
      [removedRecord.id],
    ),
    (error) => error.driverError?.code === '23514',
  );
  pass(
    'expired/invalidated sessions cannot stream or complete; native declared-byte immutability, lease bounds and terminal guards hold',
  );

  const injectedCommit = async (item, afterCommit = false) => {
    const createRunner = source.createQueryRunner.bind(source);
    let injected = false;
    source.createQueryRunner = (...args) => {
      const runner = createRunner(...args),
        commit = runner.commitTransaction.bind(runner);
      runner.commitTransaction = async () => {
        const rows = await runner.query(
          'SELECT state FROM card_attachments WHERE id=$1',
          [item.intent.uploadId],
        );
        if (!injected && rows[0]?.state === 'ACTIVE') {
          injected = true;
          if (afterCommit) await commit();
          throw new Error('Injected private file COMMIT failure');
        }
        return commit();
      };
      return runner;
    };
    try {
      const result = await outcome(item.complete());
      assert.match(
        result.error.message,
        /Injected private file COMMIT failure/,
      );
      assert.equal(injected, true);
    } finally {
      source.createQueryRunner = createRunner;
    }
  };
  const expireLease = async (id) =>
    source.query(
      "UPDATE card_attachments SET verification_expires_at=now()-interval '1 second',revision=revision+1 WHERE id=$1",
      [id],
    );
  const recovery = await ready('Storage success DB failure');
  await injectedCommit(recovery);
  assert.ok(
    storage.objects.has(`attachments/v1/active/${recovery.intent.uploadId}`),
  );
  assert.equal(
    (
      await source.query('SELECT state FROM card_attachments WHERE id=$1', [
        recovery.intent.uploadId,
      ])
    )[0].state,
    'PENDING',
  );
  await expireLease(recovery.intent.uploadId);
  const restarted = new CardAttachmentFilesService(
    source.getRepository(Board),
    app.get(BoardAuthorizationService),
    storage,
    new AttachmentContentService(),
    app.get(BoardEventPublisher),
    app.get(ConfigService),
  );
  const recovered = await restarted.complete(
    actor(),
    board.id,
    recovery.target.id,
    recovery.intent.uploadId,
  );
  assert.equal(recovered.state, 'ACTIVE');
  const conflicting = await ready('Immutable conflict recovery');
  await injectedCommit(conflicting);
  await expireLease(conflicting.intent.uploadId);
  storage.objects.set(`attachments/v1/pending/${conflicting.intent.uploadId}`, {
    body: Buffer.from('other'),
    contentType: 'text/plain',
  });
  await assert.rejects(
    restarted.complete(
      actor(),
      board.id,
      conflicting.target.id,
      conflicting.intent.uploadId,
    ),
    (error) => error.getStatus() === 422,
  );
  assert.equal(
    (
      await source.query('SELECT state FROM card_attachments WHERE id=$1', [
        conflicting.intent.uploadId,
      ])
    )[0].state,
    'FAILED',
  );
  const acknowledgement = await ready('Lost DB acknowledgement');
  await injectedCommit(acknowledgement, true);
  assert.equal(
    (
      await source.query('SELECT state FROM card_attachments WHERE id=$1', [
        acknowledgement.intent.uploadId,
      ])
    )[0].state,
    'ACTIVE',
  );
  assert.equal((await acknowledgement.complete()).state, 'ACTIVE');
  pass(
    'storage-success/DB-rollback and lost-ack retries recover across service restart; mismatched immutable objects fail closed',
  );

  const grant = storage.createUploadGrant.bind(storage),
    requestKey = randomUUID();
  storage.createUploadGrant = async () => {
    throw new Error('Injected grant outage');
  };
  let failedIntent;
  try {
    await assert.rejects(
      files.createIntent(actor(), board.id, card.id, input, requestKey),
    );
    failedIntent = (
      await source.query(
        'SELECT id FROM card_attachments WHERE idempotency_key=$1',
        [requestKey],
      )
    )[0].id;
  } finally {
    storage.createUploadGrant = grant;
  }
  assert.equal(
    (await files.createIntent(actor(), board.id, card.id, input, requestKey))
      .uploadId,
    failedIntent,
  );
  const ambiguous = await ready('Ambiguous provider PUT');
  const write = storage.writeVerified.bind(storage);
  storage.writeVerified = async (request) => {
    await write(request);
    throw new Error('Injected provider acknowledgement loss');
  };
  try {
    await assert.rejects(ambiguous.complete());
  } finally {
    storage.writeVerified = write;
  }
  await expireLease(ambiguous.intent.uploadId);
  assert.equal((await ambiguous.complete()).state, 'ACTIVE');
  pass(
    'grant issuance and ambiguous verified PUT failures retain durable reservations and recover without duplicate records or destructive compensation',
  );
}
