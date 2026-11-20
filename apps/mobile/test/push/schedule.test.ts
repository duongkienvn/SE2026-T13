import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeSchedule,
  validatePatch,
  validSchedule,
  timeChoices,
  schedulePatch,
  beginDraft,
  receiveSchedule,
  reconcileSave,
} from '../../src/features/push/schedule/model.ts';
import {
  createScheduleApi,
  scheduleOptions,
  scheduleKey,
} from '../../src/features/push/schedule/api.ts';
import { scheduleCommands } from '../../src/features/push/schedule/mutations.ts';
import { integration, json, ok } from '../realtime/integration-support.ts';
import { flush, loginResponse, USER_B } from '../auth/support.ts';
import { onlineManager } from '@tanstack/react-query';
const defaults = () => ({
  enabled: false,
  startLocal: '22:00',
  endLocal: '07:00',
  timeZone: 'UTC',
});

test('strict decoder and patch allowlists, 96 clock choices and effective validation', () => {
  assert.deepEqual(decodeSchedule(defaults()), defaults());
  assert.equal(timeChoices.length, 96);
  assert.equal(timeChoices[0], '00:00');
  assert.equal(timeChoices[95], '23:45');
  for (const time of timeChoices)
    assert.deepEqual(validatePatch({ startLocal: time }), { startLocal: time });
  for (const invalid of [
    {},
    [],
    { enabled: null },
    { enabled: 'true' },
    { startLocal: '24:00' },
    { endLocal: '07:01' },
    { startLocal: '9:00' },
    { startLocal: '09:00\n' },
    { timeZone: 'UTC' },
    { userId: 'other' },
  ])
    assert.throws(() => validatePatch(invalid));
  for (const invalid of [
    { ...defaults(), timeZone: 'bad/zone' },
    { ...defaults(), extra: true },
    { ...defaults(), enabled: true, startLocal: '07:00' },
    { ...defaults(), enabled: 'false' },
  ])
    assert.throws(() => decodeSchedule(invalid));
  assert.equal(validSchedule({ ...defaults(), startLocal: '07:00' }), true);
  assert.equal(
    validSchedule({ enabled: true, startLocal: '00:15', endLocal: '00:00' }),
    true,
  );
});
test('draft rebase retains local intent, updates timezone, requires review and never patches timezone', () => {
  const initial = beginDraft(defaults());
  const dirty = {
    ...initial,
    draft: { ...initial.draft, startLocal: '21:45' },
  };
  const updated = receiveSchedule(dirty, {
    ...defaults(),
    timeZone: 'Asia/Tokyo',
    endLocal: '08:00',
  });
  assert.equal(updated.draft.startLocal, '21:45');
  assert.equal(updated.draft.timeZone, 'Asia/Tokyo');
  assert.equal(updated.draft.endLocal, '08:00');
  assert.equal(updated.conflict, true);
  assert.deepEqual(schedulePatch(updated.saved, updated.draft), {
    startLocal: '21:45',
  });
  assert.equal(
    receiveSchedule(initial, { ...defaults(), timeZone: 'Asia/Tokyo' })
      .conflict,
    false,
  );
  const submitted = dirty;
  const current = { ...dirty, draft: { ...dirty.draft, startLocal: '22:00' } };
  assert.equal(
    reconcileSave(current, submitted, { ...defaults(), startLocal: '21:45' })
      .draft.startLocal,
    '22:00',
  );
});
test('account schedule requests ignore unrelated Board aggregate fences', async () => {
  const env = await integration();
  try {
    const key = scheduleKey(env.identity);
    const check = env.data.resources.capture(key, false);
    env.data.resources.fenceAggregates();
    assert.doesNotThrow(check);
    env.data.resources.bumpKey(key);
    assert.throws(check);
  } finally {
    env.dispose();
  }
});
test('session API contract and sparse PATCH do not modify Push opt-in or Inbox', async () => {
  const env = await integration();
  try {
    const server = defaults();
    env.respond(async (url, init) => {
      assert.equal(new URL(url).pathname, '/api/users/me/push-schedule');
      if (init.method === 'PATCH') {
        assert.deepEqual(JSON.parse(init.body as string), { enabled: true });
        server.enabled = true;
      }
      return ok(server);
    });
    const api = createScheduleApi(env.data.api, env.identity),
      signal = new AbortController().signal;
    assert.deepEqual(await api.get(signal), defaults());
    assert.equal((await api.patch({ enabled: true }, signal)).enabled, true);
    await assert.rejects(async () =>
      api.patch({ timeZone: 'UTC' } as never, signal),
    );
    assert.equal(env.requests.length, 2);
  } finally {
    env.dispose();
  }
});
test('concurrent Save is fenced; full server ACK is authoritative; no empty writes', async () => {
  const env = await integration();
  try {
    let finish!: (response: Response) => void;
    env.respond(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const commands = scheduleCommands(env.data, env.identity);
    assert.equal(await commands.save({}), undefined);
    const first = commands.save({ enabled: true });
    await flush();
    await assert.rejects(commands.save({ startLocal: '21:00' }));
    const ack = { ...defaults(), enabled: true, timeZone: 'Europe/Paris' };
    finish(ok(ack));
    assert.deepEqual(await first, ack);
    assert.deepEqual(
      env.data.queryClient.getQueryData(scheduleKey(env.identity)),
      ack,
    );
    assert.equal(env.requests.length, 1);
  } finally {
    env.dispose();
  }
});
test('network/5xx/invalid response uncertainty survives GET and screen remount', async () => {
  for (const response of [json({}, 500), ok({}), null]) {
    const env = await integration();
    try {
      env.respond(async () => {
        if (!response) throw new TypeError('lost connection');
        return response;
      });
      const commands = scheduleCommands(env.data, env.identity);
      await assert.rejects(commands.save({ enabled: true }));
      assert.equal(commands.getSnapshot().mustVerify, true);
      env.respond(async () => ok(defaults()));
      await commands.verify();
      assert.equal(scheduleCommands(env.data, env.identity), commands);
      await assert.rejects(commands.save({ enabled: false }));
      assert.equal(env.requests.length, 2);
    } finally {
      env.dispose();
    }
  }
});
test('400 recoverable; 429 endpoint cooldown prevents reads/writes/remount bypass', async () => {
  const env = await integration();
  try {
    const commands = scheduleCommands(env.data, env.identity);
    env.respond(async () => json({}, 400));
    await assert.rejects(commands.save({ enabled: true }));
    assert.equal(commands.getSnapshot().mustVerify, false);
    env.respond(
      async () =>
        new Response('{}', {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '60' },
        }),
    );
    await assert.rejects(commands.save({ enabled: true }));
    await assert.rejects(commands.verify());
    await assert.rejects(
      env.data.queryClient.fetchQuery(scheduleOptions(env.data, env.identity)),
    );
    assert.equal(env.requests.length, 2);
  } finally {
    env.dispose();
  }
});
test('offline blocks sending without uncertainty; 401 ends only initiating session', async () => {
  const env = await integration();
  try {
    const commands = scheduleCommands(env.data, env.identity);
    onlineManager.setOnline(false);
    await assert.rejects(commands.save({ enabled: true }));
    assert.equal(env.requests.length, 0);
    assert.equal(commands.getSnapshot().mustVerify, false);
    onlineManager.setOnline(true);
    env.respond(async () => json({}, 401));
    await assert.rejects(commands.save({ enabled: true }));
    assert.equal(env.data.getIdentity(), null);
  } finally {
    onlineManager.setOnline(true);
    env.dispose();
  }
});
test('late A PATCH and stale GET cannot restore protected values after A→B switch', async () => {
  const env = await integration();
  const A = env.identity;
  try {
    let finish!: (response: Response) => void;
    env.respond(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const saving = scheduleCommands(env.data, A)
      .save({ enabled: true })
      .catch(() => undefined);
    await flush();
    await env.manager.logout();
    await env.manager.establishSession(loginResponse(USER_B));
    finish(ok({ ...defaults(), enabled: true }));
    await saving;
    assert.equal(env.data.queryClient.getQueryData(scheduleKey(A)), undefined);
    assert.equal(
      env.data.queryClient.getQueryData(scheduleKey(env.identity)),
      undefined,
    );
    await assert.rejects(
      createScheduleApi(env.data.api, A).get(new AbortController().signal),
    );
  } finally {
    env.dispose();
  }
});
test('a read started during PATCH cannot overwrite the confirmed ACK', async () => {
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
    const write = scheduleCommands(env.data, env.identity).save({
      enabled: true,
    });
    await flush();
    const read = env.data.queryClient
      .fetchQuery(scheduleOptions(env.data, env.identity))
      .catch(() => undefined);
    await flush();
    finishWrite(ok({ ...defaults(), enabled: true }));
    await write;
    finishRead(ok(defaults()));
    await read;
    assert.equal(
      env.data.queryClient.getQueryData<{ enabled: boolean }>(
        scheduleKey(env.identity),
      )?.enabled,
      true,
    );
  } finally {
    env.dispose();
  }
});
