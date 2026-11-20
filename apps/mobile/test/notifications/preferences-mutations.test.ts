import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preferenceCommands } from '../../src/features/notifications/preferences/mutations.ts';
import { preferencesOptions } from '../../src/features/notifications/preferences/api.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { integration, json, ok } from '../realtime/integration-support.ts';
import { defaults } from './preferences-fixtures.ts';
import { flush, loginResponse, USER_A, USER_B } from '../auth/support.ts';

test('single-flight save never retries, blocks empty patches and reconciles the full 200', async () => {
  const env = await integration();
  try {
    let finish!: (response: Response) => void;
    env.respond(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const commands = preferenceCommands(env.data, env.identity, true);
    const unreadKey = queryKeys.unreadCount(env.identity);
    env.data.queryClient.setQueryData(unreadKey, 7);
    assert.equal(await commands.save({}), undefined);
    assert.equal(env.requests.length, 0);
    const saving = commands.save({ inApp: { cardAssigned: false } });
    await flush();
    await assert.rejects(commands.save({ email: { dueReminder: true } }));
    const response = defaults();
    response.inApp.cardAssigned = false;
    response.email.commentMentioned = true;
    finish(ok(response));
    assert.deepEqual(await saving, response);
    assert.deepEqual(
      env.data.queryClient.getQueryData(
        queryKeys.notificationPreferences(env.identity),
      ),
      response,
    );
    assert.equal(env.requests.length, 1);
    assert.equal(commands.getSnapshot().pending, null);
    assert.equal(env.data.queryClient.getQueryState(unreadKey)?.data, 7);
    assert.equal(
      env.data.queryClient.getQueryState(unreadKey)?.isInvalidated,
      false,
    );
  } finally {
    env.dispose();
  }
});

test('ambiguous PATCH stays write-blocked after GET, including remount', async () => {
  const env = await integration();
  try {
    env.respond(async () => {
      throw new TypeError('connection dropped');
    });
    const commands = preferenceCommands(env.data, env.identity, true);
    await assert.rejects(commands.save({ inApp: { cardAssigned: false } }));
    assert.equal(commands.getSnapshot().mustVerify, true);
    const remount = preferenceCommands(env.data, env.identity, true);
    assert.equal(remount, commands);
    await assert.rejects(remount.save({ inApp: { dueReminder: false } }));
    const response = defaults();
    response.inApp.cardAssigned = false;
    env.respond(async (_url, init) => {
      assert.equal(init.method, 'GET');
      return ok(response);
    });
    assert.deepEqual(await remount.verify(), response);
    assert.equal(remount.getSnapshot().mustVerify, true);
    env.respond(async () => ok(response));
    await assert.rejects(remount.save({ inApp: { dueReminder: false } }));
    assert.equal(env.requests.length, 2);
  } finally {
    env.dispose();
  }
});

test('definite validation failure and rate limit retain a recoverable error with cooldown', async () => {
  const env = await integration();
  try {
    const commands = preferenceCommands(env.data, env.identity, true);
    env.respond(async () => json({}, 400));
    await assert.rejects(commands.save({ inApp: { dueReminder: false } }));
    assert.equal(commands.getSnapshot().mustVerify, false);
    env.respond(
      async () =>
        new Response('{}', {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '60' },
        }),
    );
    await assert.rejects(commands.save({ inApp: { dueReminder: false } }));
    await assert.rejects(commands.save({ inApp: { dueReminder: false } }));
    assert.equal(env.requests.length, 2);
    assert.equal(commands.getSnapshot().mustVerify, false);
    assert.ok(commands.getSnapshot().errorUpdatedAt > 0);
  } finally {
    env.dispose();
  }
});

test('pre-save GET cancellation and a late ACK cannot resurrect old-session preferences', async () => {
  const env = await integration();
  const identity = env.identity;
  try {
    let finish!: (response: Response) => void;
    env.respond(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const read = env.data.queryClient.fetchQuery(
      preferencesOptions(env.data, identity),
    );
    const readOutcome = read.catch(() => undefined);
    await flush();
    const staleRead = finish;
    const commands = preferenceCommands(env.data, identity, true);
    const write = commands.save({ inApp: { cardAssigned: false } });
    const writeOutcome = write.catch(() => undefined);
    await flush();
    staleRead(ok(defaults()));
    await env.manager.logout();
    await env.manager.establishSession(loginResponse(USER_B));
    finish(ok(defaults()));
    await Promise.all([readOutcome, writeOutcome]);
    assert.equal(
      env.data.queryClient.getQueryData(
        queryKeys.notificationPreferences(identity),
      ),
      undefined,
    );
    assert.equal(
      env.data.queryClient.getQueryData(
        queryKeys.notificationPreferences(env.identity),
      ),
      undefined,
    );
    await assert.rejects(commands.save({ inApp: { dueReminder: false } }));
  } finally {
    env.dispose();
  }
});

test('a GET begun during PATCH cannot overwrite the authoritative ACK', async () => {
  const env = await integration();
  try {
    let finishWrite!: (response: Response) => void,
      finishRead!: (response: Response) => void;
    env.respond(
      (_url, init) =>
        new Promise((resolve) => {
          if (init.method === 'PATCH') finishWrite = resolve;
          else finishRead = resolve;
        }),
    );
    const write = preferenceCommands(env.data, env.identity, true).save({
      inApp: { cardAssigned: false },
    });
    await flush();
    const late = env.data.queryClient
      .fetchQuery(preferencesOptions(env.data, env.identity))
      .catch(() => undefined);
    await flush();
    const authoritative = defaults();
    authoritative.inApp.cardAssigned = false;
    finishWrite(ok(authoritative));
    await write;
    finishRead(ok(defaults()));
    await late;
    assert.deepEqual(
      env.data.queryClient.getQueryData(
        queryKeys.notificationPreferences(env.identity),
      ),
      authoritative,
    );
  } finally {
    env.dispose();
  }
});

test('expired-session render lookup is passive while subsequent actions remain guarded', async () => {
  const env = await integration();
  const identity = env.identity;
  try {
    await env.manager.logout();
    const commands = preferenceCommands(env.data, identity, true);
    await assert.rejects(commands.save({ inApp: { cardAssigned: false } }));
    await assert.rejects(commands.verify());
    assert.equal(env.requests.length, 0);
  } finally {
    env.dispose();
  }
});

test('5xx and malformed 200 writes stay uncertain even after successful GET', async () => {
  for (const response of [json({}, 503), ok({ inApp: {} })]) {
    const env = await integration();
    try {
      const commands = preferenceCommands(env.data, env.identity, true);
      env.respond(async () => response);
      await assert.rejects(commands.save({ inApp: { dueReminder: false } }));
      assert.equal(commands.getSnapshot().mustVerify, true);
      env.respond(async () => json({}, 503));
      await assert.rejects(commands.verify());
      assert.equal(commands.getSnapshot().mustVerify, true);
      await assert.rejects(commands.save({ inApp: { dueReminder: false } }));
      assert.equal(env.requests.length, 2);
      env.respond(async () => ok(defaults()));
      await commands.verify();
      assert.equal(commands.getSnapshot().mustVerify, true);
      await assert.rejects(commands.save({ inApp: { dueReminder: false } }));
    } finally {
      env.dispose();
    }
  }
});

test('GET before a delayed PATCH commit cannot unlock sparse writes, even across concurrent edits', async () => {
  const env = await integration();
  try {
    const server = defaults();
    let commit!: () => void;
    env.respond((url, init) => {
      if (!url.endsWith('/notification-preferences')) return null;
      if (init.method === 'PATCH') {
        const patch = JSON.parse(init.body as string);
        return new Promise((resolve) => {
          commit = () => {
            Object.assign(server.inApp, patch.inApp);
            resolve(ok(server));
          };
        });
      }
      return Promise.resolve(ok(server));
    });
    const commands = preferenceCommands(env.data, env.identity, true);
    const write = commands.save({
      inApp: { cardAssigned: false, dueReminder: false },
    });
    const timedOut = assert.rejects(write);
    await flush();
    env.time.advance(31_000);
    await timedOut;
    assert.deepEqual(await commands.verify(), defaults());
    assert.equal(commands.getSnapshot().mustVerify, true);
    // A stale GET would omit the user's newer assignments=true choice from a
    // second sparse PATCH. Such a PATCH must never reach the transport.
    await assert.rejects(commands.save({ inApp: { dueReminder: false } }));
    server.email.commentMentioned = true; // Concurrent Web edit.
    commit(); // The timed-out request really does commit after that GET.
    await flush();
    assert.equal((await commands.verify()).email.commentMentioned, true);
    assert.equal(commands.getSnapshot().mustVerify, true);
    await assert.rejects(commands.save({ inApp: { cardAssigned: true } }));
    assert.equal(
      env.requests.filter(({ init }) => init.method === 'PATCH').length,
      1,
    );
  } finally {
    env.dispose();
  }
});

test('account switching cannot discard unresolved write uncertainty for the same user', async () => {
  const env = await integration();
  try {
    env.respond(async () => {
      throw new TypeError('connection lost');
    });
    const first = preferenceCommands(env.data, env.identity, true);
    await assert.rejects(first.save({ inApp: { cardAssigned: false } }));
    await env.manager.logout();
    await env.manager.establishSession(loginResponse(USER_B));
    assert.equal(
      preferenceCommands(env.data, env.identity, true).getSnapshot().mustVerify,
      false,
    );
    await env.manager.logout();
    await env.manager.establishSession(loginResponse(USER_A));
    const next = preferenceCommands(env.data, env.identity, true);
    assert.equal(next.getSnapshot().mustVerify, true);
    env.respond(async () => ok(defaults()));
    await next.verify();
    await assert.rejects(next.save({ inApp: { cardAssigned: false } }));
  } finally {
    env.dispose();
  }
});

test('cancellation before transport starts does not permanently block future saves', async () => {
  const env = await integration();
  try {
    const commands = preferenceCommands(env.data, env.identity, true);
    const pending = commands.save({ inApp: { cardAssigned: false } });
    const stopped = assert.rejects(
      pending,
      (error: unknown) =>
        error instanceof Error &&
        'requestStarted' in error &&
        error.requestStarted === false,
    );
    commands.abort();
    await stopped;
    assert.equal(env.requests.length, 0);
    assert.equal(commands.getSnapshot().mustVerify, false);
    env.respond(async () => ok(defaults()));
    await commands.save({ inApp: { cardAssigned: false } });
    assert.equal(env.requests.length, 1);
  } finally {
    env.dispose();
  }
});

test('a replacement command owner cannot race an aborted in-flight write before classification', async () => {
  const env = await integration();
  try {
    env.respond(() => new Promise(() => {}));
    const first = preferenceCommands(env.data, env.identity, true);
    const write = first.save({ inApp: { cardAssigned: false } });
    const cancelled = assert.rejects(write);
    await flush();
    const replacement = preferenceCommands(env.data, env.identity, false);
    await assert.rejects(replacement.save({ inApp: { dueReminder: false } }));
    await cancelled;
    await assert.rejects(replacement.save({ inApp: { dueReminder: false } }));
    assert.equal(replacement.getSnapshot().mustVerify, true);
    assert.equal(env.requests.length, 1);
  } finally {
    env.dispose();
  }
});

test('timeout and unmount cancellation cannot cache a late successful write', async () => {
  for (const outcome of ['timeout', 'unmount']) {
    const env = await integration();
    try {
      let finish!: (response: Response) => void;
      env.respond((url) =>
        url.endsWith('/notification-preferences')
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : null,
      );
      const commands = preferenceCommands(env.data, env.identity, true);
      const pending = commands.save({ inApp: { cardAssigned: false } });
      const failed = assert.rejects(pending);
      await flush();
      if (outcome === 'timeout') env.time.advance(31_000);
      else commands.abort();
      await failed;
      finish(ok(defaults()));
      await flush();
      assert.equal(commands.getSnapshot().mustVerify, true);
      assert.equal(
        env.data.queryClient.getQueryData(
          queryKeys.notificationPreferences(env.identity),
        ),
        undefined,
      );
      assert.equal(
        env.requests.filter(({ init }) => init.method === 'PATCH').length,
        1,
      );
    } finally {
      env.dispose();
    }
  }
});

test('offline before transport never queues a PATCH and retains a definite retry path', async () => {
  const env = await integration();
  try {
    env.environment(true, false);
    const commands = preferenceCommands(env.data, env.identity, true);
    await assert.rejects(commands.save({ inApp: { cardAssigned: false } }));
    assert.equal(commands.getSnapshot().mustVerify, false);
    assert.equal(env.requests.length, 0);
    env.environment(true, true);
    env.respond(async () => ok(defaults()));
    await commands.save({ inApp: { cardAssigned: false } });
    assert.equal(
      env.requests.filter(({ init }) => init.method === 'PATCH').length,
      1,
    );
  } finally {
    env.dispose();
  }
});
