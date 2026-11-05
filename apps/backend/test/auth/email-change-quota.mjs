import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  PendingEmailChange,
} = require('../../dist/api/auth/entities/pending-email-change.entity.js');
const { User } = require('../../dist/api/users/entities/user.entity.js');
const {
  EmailChangeService,
} = require('../../dist/api/auth/email-change.service.js');
const { ConfigService } = require('@nestjs/config');

export async function verifyEmailChangeQuotaAndFailures(context) {
  const {
    source,
    changes,
    reauth,
    mailer,
    factory,
    session,
    issue,
    tokenFor,
    age,
    code,
    pass,
    password,
    security,
    resetMailer,
  } = context;
  const actor = await factory(),
    target = 'quota-one@email-change.test';
  const current = await issue(actor, target),
    first = tokenFor(target);
  const previous = await source
    .getRepository(PendingEmailChange)
    .findOneByOrFail({ userId: actor.id });
  const count = mailer.proofs.length;
  await issue(actor, 'cooldown-blocked@email-change.test');
  assert.equal(mailer.proofs.length, count);
  assert.equal(
    (
      await source
        .getRepository(PendingEmailChange)
        .findOneByOrFail({ userId: actor.id })
    ).tokenHash,
    previous.tokenHash,
  );
  await age(actor, 2);
  await issue(actor, 'rotated@email-change.test');
  const rotated = tokenFor('rotated@email-change.test');
  assert.notEqual(first, rotated);
  await code(
    changes.confirm(current.identity, first),
    'INVALID_EMAIL_CHANGE_TOKEN',
  );
  await age(actor, 31);
  assert.equal(await changes.pending(current.identity), null);
  await code(
    changes.confirm(current.identity, rotated),
    'INVALID_EMAIL_CHANGE_TOKEN',
  );
  // Quota is persisted, includes expired proofs, and survives service recreation.
  await issue(actor, 'quota-three@email-change.test');
  await age(actor, 2);
  await issue(actor, 'quota-four@email-change.test');
  await age(actor, 2);
  await issue(actor, 'quota-five@email-change.test');
  const fifth = await source
    .getRepository(PendingEmailChange)
    .findOneByOrFail({ userId: actor.id });
  assert.equal(fifth.issuanceAttempts.length, 5);
  await age(actor, 2);
  const recreated = new EmailChangeService(
    source,
    mailer,
    new ConfigService({ PUBLIC_APP_URL: 'http://localhost:5173' }),
    { revokeUserSessions() {} },
  );
  const proof = await reauth.verify(current.identity, {
    newEmail: 'sixth@email-change.test',
    currentPassword: password,
  });
  await recreated.request(proof, 'sixth@email-change.test');
  assert.equal(
    (
      await source
        .getRepository(PendingEmailChange)
        .findOneByOrFail({ userId: actor.id })
    ).tokenHash,
    fifth.tokenHash,
  );
  await source.query(
    "UPDATE pending_email_changes SET issuance_attempts=ARRAY[statement_timestamp()-interval '61 minutes',statement_timestamp()-interval '45 minutes',statement_timestamp()-interval '30 minutes',statement_timestamp()-interval '15 minutes',statement_timestamp()-interval '2 minutes'] WHERE user_id=$1",
    [actor.id],
  );
  await recreated.request(proof, 'sixth@email-change.test');
  assert.equal(
    (
      await source
        .getRepository(PendingEmailChange)
        .findOneByOrFail({ userId: actor.id })
    ).issuanceAttempts.length,
    5,
  );
  assert.ok(tokenFor('sixth@email-change.test'));
  const after = await source
    .getRepository(PendingEmailChange)
    .findOneByOrFail({ userId: actor.id });
  assert.equal(after.id, previous.id);
  assert.equal(
    (
      await source.query(
        'SELECT count(*)::int n FROM pending_email_changes WHERE user_id=$1',
        [actor.id],
      )
    )[0].n,
    1,
  );
  pass(
    'hash-only single pending row, exact TTL, cooldown, rotation, expiry and true rolling 5/hour quota survive service restart',
  );
  for (const sql of [
    "UPDATE pending_email_changes SET expires_at=expires_at+interval '1 second' WHERE user_id=$1",
    "UPDATE pending_email_changes SET token_hash=repeat('z',64) WHERE user_id=$1",
    "UPDATE pending_email_changes SET new_email='UPPER@example.test' WHERE user_id=$1",
    'UPDATE pending_email_changes SET issuance_attempts=array_fill(now(),ARRAY[6]) WHERE user_id=$1',
  ])
    await assert.rejects(
      source.query(sql, [actor.id]),
      (error) => error.driverError.code === '23514',
    );
  const duplicate = await factory();
  await assert.rejects(
    source.query(
      `INSERT INTO pending_email_changes(user_id,token_hash,new_email,original_email,original_auth_version,created_at,expires_at,issuance_attempts)
    SELECT $2,token_hash,new_email,original_email,original_auth_version,created_at,expires_at,issuance_attempts FROM pending_email_changes WHERE user_id=$1`,
      [actor.id, duplicate.id],
    ),
    (error) => error.driverError.code === '23505',
  );
  const disposable = await factory();
  await issue(disposable, 'delete-fixture@email-change.test');
  await source.getRepository(User).delete(disposable.id);
  assert.equal(
    await source
      .getRepository(PendingEmailChange)
      .countBy({ userId: disposable.id }),
    0,
  );
  pass(
    'PostgreSQL enforces exact TTL, normalized email, hash shape, bounded quota, unique proof hash and safe User FK cleanup',
  );

  const failureActor = await factory(),
    failureSession = await session(failureActor),
    originalSend = mailer.sendProof;
  // Model ambiguous delivery: provider captures the message, then reports failure.
  mailer.sendProof = async function (...args) {
    await originalSend.apply(this, args);
    throw new Error('provider-private-sentinel');
  };
  try {
    await issue(failureActor, 'ambiguous@email-change.test');
  } finally {
    mailer.sendProof = originalSend;
  }
  const ambiguous = await source
    .getRepository(PendingEmailChange)
    .findOneByOrFail({ userId: failureActor.id });
  assert.equal(ambiguous.sentAt, null);
  assert.equal(ambiguous.issuanceAttempts.length, 1);
  const originalAlert = mailer.sendSecurityAlert;
  mailer.sendSecurityAlert = async () => {
    throw new Error('old-alert-private-sentinel');
  };
  try {
    await changes.confirm(
      failureSession.identity,
      tokenFor('ambiguous@email-change.test'),
    );
  } finally {
    mailer.sendSecurityAlert = originalAlert;
  }
  assert.equal(
    (await source.getRepository(User).findOneByOrFail({ id: failureActor.id }))
      .email,
    'ambiguous@email-change.test',
  );
  pass(
    'ambiguous send keeps usable proof/quota; old-mailbox provider failure cannot roll back committed email',
  );

  const delayedActor = await factory(),
    delayedSession = await session(delayedActor);
  let release, started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  mailer.sendProof = async function (...args) {
    started();
    await gate;
    return originalSend.apply(this, args);
  };
  const delayedProof = await reauth.verify(delayedSession.identity, {
    newEmail: 'delayed@email-change.test',
    currentPassword: password,
  });
  let pending;
  try {
    pending = changes.request(delayedProof, 'delayed@email-change.test');
    await ready;
    // A separate User-locking credential flow completes while provider I/O waits.
    await security.change(delayedActor.id, 0, password, 'ChangedPass2!');
    assert.equal(
      (
        await source
          .getRepository(User)
          .findOneByOrFail({ id: delayedActor.id })
      ).authVersion,
      1,
    );
    release();
    await pending;
  } finally {
    release();
    mailer.sendProof = originalSend;
    if (pending) await pending;
  }
  await code(
    changes.confirm(
      (await session(delayedActor)).identity,
      tokenFor('delayed@email-change.test'),
    ),
    'INVALID_EMAIL_CHANGE_TOKEN',
  );
  pass(
    'provider I/O holds no User lock and password/version changes invalidate pending mailbox proofs',
  );
  const rotationActor = await factory(),
    rotationSession = await session(rotationActor);
  let releaseOld, oldStarted;
  const oldGate = new Promise((resolve) => {
      releaseOld = resolve;
    }),
    oldReady = new Promise((resolve) => {
      oldStarted = resolve;
    });
  mailer.sendProof = async function (email, ...args) {
    if (email === 'delayed-old@email-change.test') {
      oldStarted();
      await oldGate;
    }
    return originalSend.call(this, email, ...args);
  };
  let oldRequest;
  try {
    oldRequest = issue(rotationActor, 'delayed-old@email-change.test');
    await oldReady;
    await age(rotationActor, 2);
    await issue(rotationActor, 'delayed-new@email-change.test');
    const newer = await source
      .getRepository(PendingEmailChange)
      .findOneByOrFail({ userId: rotationActor.id });
    releaseOld();
    await oldRequest;
    const retained = await source
      .getRepository(PendingEmailChange)
      .findOneByOrFail({ userId: rotationActor.id });
    assert.equal(retained.tokenHash, newer.tokenHash);
    assert.equal(retained.sentAt.getTime(), newer.sentAt.getTime());
    await code(
      changes.confirm(
        rotationSession.identity,
        tokenFor('delayed-old@email-change.test'),
      ),
      'INVALID_EMAIL_CHANGE_TOKEN',
    );
    await changes.confirm(
      rotationSession.identity,
      tokenFor('delayed-new@email-change.test'),
    );
  } finally {
    releaseOld();
    mailer.sendProof = originalSend;
    if (oldRequest) await oldRequest;
  }
  pass(
    'late provider completion cannot overwrite rotated proof or its sentAt annotation',
  );

  const rollbackActor = await factory(),
    rollbackSession = await issue(rollbackActor, 'rollback@email-change.test'),
    rollbackToken = tokenFor('rollback@email-change.test');
  await security.send(rollbackActor.email);
  const recovery = new URL(resetMailer.deliveries.at(-1).url).searchParams.get(
    'token',
  );
  await source.query(
    `CREATE FUNCTION reject_email_change_consume() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${rollbackActor.id}'::uuid AND NEW.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'synthetic rollback'; END IF; RETURN NEW; END $$`,
  );
  await source.query(
    'CREATE TRIGGER reject_email_change_consume BEFORE UPDATE ON pending_email_changes FOR EACH ROW EXECUTE FUNCTION reject_email_change_consume()',
  );
  try {
    await assert.rejects(
      changes.confirm(rollbackSession.identity, rollbackToken),
    );
  } finally {
    await source.query(
      'DROP TRIGGER reject_email_change_consume ON pending_email_changes',
    );
    await source.query('DROP FUNCTION reject_email_change_consume()');
  }
  const retained = await source
    .getRepository(User)
    .findOneByOrFail({ id: rollbackActor.id });
  assert.equal(retained.email, rollbackActor.email);
  assert.equal(retained.authVersion, 0);
  assert.equal(
    (
      await source
        .getRepository(PendingEmailChange)
        .findOneByOrFail({ userId: rollbackActor.id })
    ).consumedAt,
    null,
  );
  await security.reset(recovery, 'AfterRollback3!');
  assert.equal(
    (await source.getRepository(User).findOneByOrFail({ id: rollbackActor.id }))
      .authVersion,
    1,
  );
  pass(
    'transaction failure rolls back email/version/proof consumption and preserves previously usable recovery credentials',
  );

  const invalidActor = await factory(),
    invalidSession = await session(invalidActor),
    unrelated = await factory();
  await issue(invalidActor, 'invalid-token@email-change.test');
  const validToken = tokenFor('invalid-token@email-change.test');
  for (const token of [
    null,
    42,
    {},
    [],
    '',
    'short',
    'x'.repeat(44),
    '!'.repeat(43),
    'z'.repeat(43),
  ])
    await code(
      changes.confirm(invalidSession.identity, token),
      'INVALID_EMAIL_CHANGE_TOKEN',
    );
  await code(
    changes.confirm((await session(unrelated)).identity, validToken),
    'INVALID_EMAIL_CHANGE_TOKEN',
  );
  assert.equal(
    (
      await source
        .getRepository(PendingEmailChange)
        .findOneByOrFail({ userId: invalidActor.id })
    ).consumedAt,
    null,
  );
  await changes.confirm(invalidSession.identity, validToken);
  await code(
    changes.confirm((await session(invalidActor)).identity, validToken),
    'INVALID_EMAIL_CHANGE_TOKEN',
  );
  pass(
    'malformed, nonexistent, cross-account and replayed proofs fail without consuming another user intent',
  );
}
