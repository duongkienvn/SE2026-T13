import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { User } = require('../../dist/api/users/entities/user.entity.js');
const {
  PendingEmailChange,
} = require('../../dist/api/auth/entities/pending-email-change.entity.js');

export async function verifyEmailChangeRaces(context) {
  const {
    source,
    changes,
    reauth,
    auth,
    google,
    security,
    profiles,
    factory,
    session,
    issue,
    tokenFor,
    code,
    pass,
    password,
  } = context;
  const actor = await factory(),
    current = await issue(actor, 'concurrent-confirm@email-change.test'),
    token = tokenFor('concurrent-confirm@email-change.test');
  const confirmations = await Promise.allSettled([
    changes.confirm(current.identity, token),
    changes.confirm(current.identity, token),
  ]);
  assert.equal(
    confirmations.filter((item) => item.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    confirmations
      .find((item) => item.status === 'rejected')
      .reason.getResponse().code,
    'INVALID_EMAIL_CHANGE_TOKEN',
  );
  assert.equal(
    (await source.getRepository(User).findOneByOrFail({ id: actor.id }))
      .authVersion,
    1,
  );
  pass(
    'two concurrent consumes serialize under User lock and exactly one succeeds',
  );

  const competing = await factory(),
    other = await factory(),
    target = 'two-accounts@email-change.test';
  const firstSession = await issue(competing, target),
    firstProof = tokenFor(target);
  const secondSession = await issue(other, target),
    secondProof = tokenFor(target);
  const contenders = await Promise.allSettled([
    changes.confirm(firstSession.identity, firstProof),
    changes.confirm(secondSession.identity, secondProof),
  ]);
  assert.equal(
    contenders.filter((item) => item.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    contenders.find((item) => item.status === 'rejected').reason.getResponse()
      .code,
    'EMAIL_CHANGE_UNAVAILABLE',
  );
  const records = await source
    .getRepository(User)
    .findBy([{ id: competing.id }, { id: other.id }]);
  assert.equal(records.filter((row) => row.email === target).length, 1);
  assert.equal(records.filter((row) => row.authVersion === 0).length, 1);
  const consumed = await source
    .getRepository(PendingEmailChange)
    .findBy([{ userId: competing.id }, { userId: other.id }]);
  assert.ok(consumed.every((row) => row.consumedAt));
  pass(
    'competing accounts cannot claim the same target; loser retains original identity and its proof is consumed',
  );

  for (const signup of ['registration', 'Google signup']) {
    const contender = await factory(),
      destination = `race-${signup === 'registration' ? 'local' : 'google'}@email-change.test`;
    const contenderSession = await issue(contender, destination),
      proof = tokenFor(destination);
    const original = source.createQueryRunner.bind(source);
    let release,
      started,
      intercepted = false;
    const gate = new Promise((resolve) => {
        release = resolve;
      }),
      ready = new Promise((resolve) => {
        started = resolve;
      });
    source.createQueryRunner = function (...args) {
      const runner = original(...args),
        query = runner.query.bind(runner);
      runner.query = async function (sql, parameters, ...rest) {
        if (
          !intercepted &&
          /^UPDATE "users" SET "email"/.test(sql) &&
          parameters?.includes(destination)
        ) {
          intercepted = true;
          started();
          await gate;
        }
        return query(sql, parameters, ...rest);
      };
      return runner;
    };
    let pending;
    try {
      pending = changes.confirm(contenderSession.identity, proof);
      await Promise.race([
        ready,
        pending.then(() => {
          throw new Error('confirmation did not reach race gate');
        }),
      ]);
      if (signup === 'registration')
        await auth.register({
          email: destination,
          password,
          displayName: 'Concurrent registration',
        });
      else {
        profiles.set('signup-race', {
          sub: 'concurrent-google-subject',
          email: destination,
          authoritativeEmail: true,
          displayName: 'Google signup',
          avatarUrl: null,
        });
        await google.signIn('signup-race');
      }
      release();
      await code(pending, 'EMAIL_CHANGE_UNAVAILABLE');
    } finally {
      release();
      source.createQueryRunner = original;
      if (pending) await pending.catch(() => undefined);
    }
    const unchanged = await source
      .getRepository(User)
      .findOneByOrFail({ id: contender.id });
    assert.equal(unchanged.email, contender.email);
    assert.equal(unchanged.authVersion, 0);
    assert.ok(
      (
        await source
          .getRepository(PendingEmailChange)
          .findOneByOrFail({ userId: contender.id })
      ).consumedAt,
    );
    assert.equal(
      await source.getRepository(User).countBy({ email: destination }),
      1,
    );
  }
  pass(
    'registration and Google signup winning after collision precheck exercise unique-index savepoint rollback and safe 409',
  );

  const passwordActor = await factory(),
    passwordSession = await issue(
      passwordActor,
      'password-race@email-change.test',
    ),
    passwordProof = tokenFor('password-race@email-change.test');
  const results = await Promise.allSettled([
    changes.confirm(passwordSession.identity, passwordProof),
    security.change(passwordActor.id, 0, password, 'ConcurrentNew3!'),
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.ok(
    ['UNAUTHORIZED', 'INVALID_EMAIL_CHANGE_TOKEN'].includes(
      results.find((item) => item.status === 'rejected').reason.getResponse()
        .code,
    ),
  );
  assert.equal(
    (await source.getRepository(User).findOneByOrFail({ id: passwordActor.id }))
      .authVersion,
    1,
  );
  pass(
    'password change versus email confirmation shares User-first lock order and prevents stale reauthentication',
  );

  const requestActor = await factory(),
    requestSession = await session(requestActor),
    input = {
      newEmail: 'request-race@email-change.test',
      currentPassword: password,
    };
  const reauthenticated = await reauth.verify(requestSession.identity, input);
  const count = context.mailer.proofs.filter(
    (item) => item.email === input.newEmail,
  ).length;
  await Promise.all(
    Array.from({ length: 8 }, () =>
      changes.request(reauthenticated, input.newEmail),
    ),
  );
  assert.equal(
    context.mailer.proofs.filter((item) => item.email === input.newEmail)
      .length,
    count + 1,
  );
  assert.equal(
    (
      await source
        .getRepository(PendingEmailChange)
        .findOneByOrFail({ userId: requestActor.id })
    ).issuanceAttempts.length,
    1,
  );
  pass(
    'eight concurrent requests produce one proof/delivery and cannot bypass persisted cooldown',
  );
}
