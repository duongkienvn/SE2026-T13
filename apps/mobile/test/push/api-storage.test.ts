import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPushApi } from '../../src/features/push/api.ts';
import { createPushStorage } from '../../src/features/push/storage.ts';
import { integration, ok } from '../realtime/integration-support.ts';
test('push REST is session fenced, strict, supports 204 and stores no token in cache', async () => {
  const env = await integration();
  try {
    env.respond(async (url, init) => {
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      if (init.method === 'POST') {
        const body = JSON.parse(init.body as string);
        return ok({ installationId: body.installationId, registered: true });
      }
      if (url.includes('/current?'))
        return ok({ registered: true, eligible: true });
      return ok({ enabled: init.method === 'PATCH', deliveryAvailable: true });
    });
    const api = createPushApi(env.data, env.identity),
      signal = new AbortController().signal;
    assert.equal((await api.get(signal)).enabled, false);
    assert.equal((await api.patch(true, signal)).enabled, true);
    await api.register(
      {
        installationId: env.identity.userId,
        projectId: env.identity.userId,
        expoPushToken: 'ExpoPushToken[abcdefghijklmnop]',
        platform: 'ios',
        appEnvironment: 'preview',
      },
      signal,
    );
    await api.remove(env.identity.userId, signal);
    assert(
      !JSON.stringify(
        env.data.queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ).includes('ExpoPushToken'),
    );
    assert.equal(
      env.requests.filter((r) => r.init.method === 'PATCH').length,
      1,
    );
    await env.manager.logout();
    await assert.rejects(() => api.get(signal));
  } finally {
    env.dispose();
  }
});
test('secure installation identity is stable and cleanup never persists routing credentials', async () => {
  const values = new Map<string, string>();
  let generated = 0;
  const store = {
    getItemAsync: async (k: string) => values.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => {
      values.set(k, v);
    },
    deleteItemAsync: async (k: string) => {
      values.delete(k);
    },
  };
  const id = '14f2550e-9359-4c06-a642-6257cb384b53';
  const storage = createPushStorage(store, () => {
    generated++;
    return id;
  });
  assert.deepEqual(
    await Promise.all([storage.installation(), storage.installation()]),
    [id, id],
  );
  assert.equal(generated, 1);
  await storage.markCleanup(id, id);
  assert.deepEqual(await storage.pending(), { userId: id, installationId: id });
  assert(![...values.values()].join().includes('token'));
  await storage.clearCleanup();
  assert.equal(await storage.pending(), null);
});
