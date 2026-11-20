import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPushController } from '../../src/features/push/controller.ts';
import { ApiError } from '../../src/infrastructure/api/errors.ts';
import { createPushStorage } from '../../src/features/push/storage.ts';
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
test('account enable on another device never implies OS consent', async () => {
  const f = fixture();
  f.setEnabled(true);
  f.setPermission('denied');
  await f.controller.reconcile();
  assert.equal(f.controller.getSnapshot().eligible, false);
  assert(!f.calls.includes('permission:true'));
  assert(!f.calls.includes('register'));
});
test('disable saves account gate before current device cleanup', async () => {
  const f = fixture();
  f.setEnabled(true);
  f.setPermission('granted');
  await f.controller.reconcile();
  f.calls.length = 0;
  await f.controller.disable();
  assert.deepEqual(f.calls, ['patch:false', 'remove']);
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
