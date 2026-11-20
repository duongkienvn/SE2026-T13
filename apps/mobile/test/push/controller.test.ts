import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPushController } from '../../src/features/push/controller.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { createPushStorage } from '../../src/features/push/storage.ts';

test('uncertain disable keeps the last confirmed account state despite stale GET', async () => {
  const f = fixture();
  f.setEnabled(true);
  f.setPermission('granted');
  await f.controller.reconcile();
  f.api.patch = async () => {
    throw new ApiError('timeout', { requestStarted: true });
  };
  await f.controller.disable();
  f.setEnabled(false);
  await f.controller.reconcile();
  assert.equal(f.controller.getSnapshot().preferences?.enabled, true);
  assert.equal(f.controller.getSnapshot().uncertain, true);
});

test('reconnect while PATCH is pending runs one verification after settlement', async () => {
  const f = fixture();
  f.setPermission('granted');
  let gets = 0,
    release!: () => void;
  f.api.get = async () => {
    gets++;
    return { enabled: false, deliveryAvailable: true };
  };
  f.api.patch = async () => {
    await new Promise<void>((r) => {
      release = r;
    });
    return { enabled: true, deliveryAvailable: true };
  };
  const saving = f.controller.enable();
  for (let i = 0; i < 20 && !release; i++)
    await new Promise((r) => setImmediate(r));
  assert(release);
  f.controller.setEnvironment({ online: false, foreground: true });
  f.controller.setEnvironment({ online: true, foreground: true });
  release();
  await saving;
  await new Promise((r) => setImmediate(r));
  assert.equal(gets, 2);
});
test('same-user login cannot drop uncertainty from an older PATCH', async () => {
  const f = fixture();
  f.setPermission('granted');
  let reject!: (error: Error) => void,
    patches = 0;
  f.api.patch = async () => {
    patches++;
    return await new Promise((_resolve, rejectCall) => {
      reject = rejectCall;
    });
  };
  const saving = f.controller.enable();
  for (let i = 0; i < 20 && !reject; i++)
    await new Promise((r) => setImmediate(r));
  assert(reject);
  f.switchOut();
  f.switchBack();
  await new Promise((r) => setImmediate(r));
  await f.controller.disable();
  assert.equal(patches, 1);
  reject(new ApiError('timeout', { requestStarted: true }));
  await saving;
  await f.controller.reconcile();
  await f.controller.enable();
  assert.equal(f.controller.getSnapshot().uncertain, true);
  assert.equal(patches, 1);
});
test('429 cooldown prevents foreground or reconnect retry loops', async () => {
  const f = fixture();
  let gets = 0;
  f.api.get = async () => {
    gets++;
    throw new ApiError('http', { status: 429, retryAfterMs: 60_000 });
  };
  await f.controller.reconcile();
  f.controller.setEnvironment({ online: false, foreground: true });
  f.controller.setEnvironment({ online: true, foreground: true });
  await f.controller.reconcile();
  assert.equal(gets, 1);
});
test('received notifications never construct Inbox rows or navigate after logout', async () => {
  const f = fixture();
  let opened = 0;
  f.controller.setOpenInbox(() => {
    opened++;
  });
  f.controller.receive({ notificationId: userId, privateTitle: 'forged' });
  assert.equal(opened, 0);
  f.switchOut();
  f.controller.tap({ notificationId: userId });
  assert.equal(opened, 0);
});

const userId = '14f2550e-9359-4c06-a642-6257cb384b53',
  install = '24f2550e-9359-4c06-a642-6257cb384b53';
function fixture() {
  let enabled = false,
    permission: 'granted' | 'denied' | 'undetermined' = 'undetermined';
  const calls: string[] = [],
    store = new Map<string, string>();
  const identity = { userId, generation: 1 };
  let live: typeof identity | null = identity;
  const api = {
    get: async () => ({ enabled, deliveryAvailable: true }),
    patch: async (value: boolean) => {
      calls.push('patch:' + value);
      enabled = value;
      return { enabled, deliveryAvailable: true };
    },
    register: async () => {
      calls.push('register');
    },
    current: async () => ({ registered: true, eligible: true }),
    remove: async () => {
      calls.push('remove');
    },
  };
  const native = {
    capability: () => 'ready' as const,
    permission: async (prompt: boolean) => {
      calls.push('permission:' + prompt);
      return permission;
    },
    token: async () => {
      calls.push('token');
      return 'ExpoPushToken[abcdefghijklmnop]';
    },
    listen: async () => () => {},
    clearResponse: async () => {},
  };
  const storage = createPushStorage(
    {
      getItemAsync: async (key) => store.get(key) ?? null,
      setItemAsync: async (key, value) => {
        store.set(key, value);
      },
      deleteItemAsync: async (key) => {
        store.delete(key);
      },
    },
    () => install,
  );
  const controller = createPushController({
    identity: () => live,
    api: () => api,
    native,
    storage,
    platform: 'android',
    projectId: '45269d99-0d21-44b6-ab8f-e73e80576fee',
    appEnvironment: 'development',
    refreshInbox: () => {},
    openInbox: () => {},
  });
  return {
    controller,
    api,
    native,
    calls,
    storage,
    setPermission: (p: typeof permission) => {
      permission = p;
    },
    setEnabled: (v: boolean) => {
      enabled = v;
    },
    switchOut: () => {
      live = null;
      controller.sessionEnded();
    },
    switchBack: () => {
      live = { userId, generation: 2 };
      controller.sessionStarted();
    },
    switchTo: (nextUserId: string) => {
      controller.sessionEnded();
      live = { userId: nextUserId, generation: 2 };
      controller.sessionStarted();
    },
  };
}
test('launch/reconnect never prompts; explicit grant registers before account enable', async () => {
  const f = fixture();
  await f.controller.reconcile();
  assert(!f.calls.includes('permission:true'));
  await f.controller.enable();
  assert.equal(f.controller.getSnapshot().preferences?.enabled, false);
  assert(!f.calls.includes('register'));
  f.setPermission('granted');
  await f.controller.enable();
  assert(f.calls.indexOf('register') < f.calls.indexOf('patch:true'));
  assert.equal(f.controller.getSnapshot().eligible, true);
});
test('observed permission revocation immediately clears eligibility even if unregister fails', async () => {
  const f = fixture();
  f.setEnabled(true);
  f.setPermission('granted');
  await f.controller.reconcile();
  assert.equal(f.controller.getSnapshot().eligible, true);
  f.setPermission('denied');
  f.api.remove = async () => {
    throw new ApiError('network');
  };
  await f.controller.reconcile();
  assert.equal(f.controller.getSnapshot().permission, 'denied');
  assert.equal(f.controller.getSnapshot().eligible, false);
  assert.deepEqual(await f.storage.pending(), {
    userId,
    installationId: install,
  });
});
test('reconnect while backgrounded defers automatic registration until foreground', async () => {
  const f = fixture();
  f.setEnabled(true);
  f.setPermission('granted');
  f.controller.setEnvironment({ online: false, foreground: false });
  f.controller.setEnvironment({ online: true, foreground: false });
  await new Promise((r) => setImmediate(r));
  assert(!f.calls.includes('register'));
  f.controller.setEnvironment({ online: true, foreground: true });
  await new Promise((r) => setImmediate(r));
  assert(f.calls.includes('register'));
});
test('account enable on another device never implies OS consent', async () => {
  const f = fixture();
  f.setEnabled(true);
  f.setPermission('denied');
  await f.controller.reconcile();
  assert.equal(f.controller.getSnapshot().eligible, false);
  assert(!f.calls.includes('permission:true'));
  assert(!f.calls.includes('register'));
});
test('disable preserves the installation session for a later explicit re-enable', async () => {
  const f = fixture();
  let retired = false;
  f.setEnabled(true);
  f.setPermission('granted');
  f.api.remove = async () => {
    retired = true;
  };
  f.api.register = async () => {
    if (retired) throw new ApiError('http', { status: 409 });
    f.calls.push('register');
  };
  await f.controller.reconcile();
  await f.controller.disable();
  assert.equal(f.controller.getSnapshot().preferences?.enabled, false);
  await f.controller.enable();
  assert.equal(f.controller.getSnapshot().preferences?.enabled, true);
  assert.equal(f.controller.getSnapshot().eligible, true);
});
test('disable uses the authoritative account gate without retiring the current session', async () => {
  const f = fixture();
  f.setEnabled(true);
  f.setPermission('granted');
  await f.controller.reconcile();
  f.calls.length = 0;
  await f.controller.disable();
  assert.deepEqual(f.calls, ['patch:false']);
  assert.equal(f.controller.getSnapshot().preferences?.enabled, false);
});
test('ambiguous PATCH followed by stale GET never unlocks writes or claims success', async () => {
  const f = fixture();
  f.setPermission('granted');
  f.api.patch = async () => {
    f.calls.push('ambiguous');
    throw new ApiError('timeout', { requestStarted: true });
  };
  await f.controller.enable();
  await f.controller.reconcile();
  await f.controller.enable();
  assert.equal(f.controller.getSnapshot().uncertain, true);
  assert.equal(f.calls.filter((c) => c === 'ambiguous').length, 1);
});
test('session change during token fetch cannot enroll the old account', async () => {
  const f = fixture();
  f.setPermission('granted');
  f.native.token = async () => {
    f.switchOut();
    return 'ExpoPushToken[abcdefghijklmnop]';
  };
  await f.controller.enable();
  assert(!f.calls.includes('register'));
  assert.equal(f.controller.getSnapshot().preferences, undefined);
});
test('User A token completing after a switch cannot register or enable; B enrolls afresh', async () => {
  const f = fixture();
  f.setPermission('granted');
  let started!: () => void, release!: (token: string) => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  f.native.token = () => {
    started();
    return new Promise((r) => {
      release = r;
    });
  };
  const enablingA = f.controller.enable();
  await ready;
  f.setEnabled(false);
  f.switchTo(install);
  release('ExpoPushToken[oldaccountabcdefghijkl]');
  await enablingA;
  await new Promise((r) => setImmediate(r));
  assert(!f.calls.includes('register'));
  assert(!f.calls.includes('patch:true'));
  f.native.token = async () => 'ExpoPushToken[newaccountabcdefghijkl]';
  await f.controller.enable();
  assert.equal(f.calls.filter((call) => call === 'register').length, 1);
  assert.equal(f.controller.getSnapshot().preferences?.enabled, true);
});
test('offline logout stores IDs only and clears rendering immediately', async () => {
  const f = fixture();
  await f.controller.reconcile();
  f.controller.setEnvironment({ online: false, foreground: true });
  await f.controller.beforeLogout();
  f.controller.sessionEnded();
  assert.deepEqual(await f.storage.pending(), {
    userId,
    installationId: install,
  });
  assert(!f.calls.includes('remove'));
  assert.equal(f.controller.getSnapshot().preferences, undefined);
});
test('a hung Expo token request times out without enabling; late token cannot register', async (t) => {
  const f = fixture();
  f.setPermission('granted');
  let tokenStarted!: () => void, release!: (token: string) => void;
  const started = new Promise<void>((resolve) => {
    tokenStarted = resolve;
  });
  f.native.token = () => {
    tokenStarted();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const enabling = f.controller.enable();
  await started;
  t.mock.timers.tick(15_000);
  await enabling;
  assert.equal(f.controller.getSnapshot().busy, false);
  assert.equal(f.controller.getSnapshot().preferences?.enabled, false);
  assert(!f.calls.includes('register'));
  release('ExpoPushToken[abcdefghijklmnop]');
  await new Promise((r) => setImmediate(r));
  assert(!f.calls.includes('register'));
});
test('logout cancels a hung native token promise without waiting for the deadline', async () => {
  const f = fixture();
  f.setPermission('granted');
  let started!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  f.native.token = () => {
    started();
    return new Promise(() => {});
  };
  const enabling = f.controller.enable();
  await ready;
  f.switchOut();
  await enabling;
  assert(!f.calls.includes('register'));
  assert.equal(f.controller.getSnapshot().busy, false);
});
test('registration failure never writes account opt-in or retains provider details', async () => {
  const f = fixture();
  f.setPermission('granted');
  f.api.register = async () => {
    throw new Error('ExpoPushToken[private-routing-material]');
  };
  await f.controller.enable();
  assert(!f.calls.includes('patch:true'));
  assert.equal(f.controller.getSnapshot().preferences?.enabled, false);
  assert(
    !JSON.stringify(f.controller.getSnapshot()).includes(
      'private-routing-material',
    ),
  );
});
test('forged push target is ignored and UUID taps only open Inbox', async () => {
  const f = fixture();
  let opened = 0;
  f.controller.setOpenInbox(() => {
    opened++;
  });
  f.controller.tap({ notificationId: 'https://evil.test' });
  assert.equal(opened, 0);
  f.controller.tap({
    notificationId: userId,
    url: 'https://evil.test',
    cardId: install,
  });
  assert.equal(opened, 1);
});
