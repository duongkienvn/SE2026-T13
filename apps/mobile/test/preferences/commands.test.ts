import { test } from 'node:test';
import assert from 'node:assert/strict';
import { integration, ok, json } from '../realtime/integration-support.ts';
import { flush, loginResponse, USER_B } from '../auth/support.ts';
import { preferencesCommands } from '../../src/features/preferences/commands.ts';
import { queryKeys } from '../../src/infrastructure/query/keys.ts';
import { saved } from './model.test.ts';

test('rapid theme previews serialize sparse writes and latest intent wins', async () => {
  const env = await integration();
  const { data, identity } = env;
  const key = queryKeys.datePreferences(identity);
  data.queryClient.setQueryData(key, saved);
  let release!: (r: Response) => void;
  const patches: unknown[] = [];
  env.respond((_url, init) => {
    patches.push(JSON.parse(init.body as string));
    if (patches.length === 1) return new Promise((r) => (release = r));
    return Promise.resolve(ok({ ...saved, theme: 'system' }));
  });
  const cmd = preferencesCommands(data, identity);
  const pending = cmd.chooseTheme('dark');
  await flush();
  void cmd.chooseTheme('light');
  void cmd.chooseTheme('system');
  assert.equal(cmd.getSnapshot().preview, 'system');
  assert.equal(patches.length, 1);
  release(ok({ ...saved, theme: 'dark' }));
  await pending;
  await flush();
  assert.deepEqual(patches, [{ theme: 'dark' }, { theme: 'system' }]);
  assert.equal(
    data.queryClient.getQueryData<typeof saved>(key)?.theme,
    'system',
  );
  assert.equal(cmd.getSnapshot().preview, null);
  env.dispose();
});
test('definite failure rolls back preview, preserves authoritative unrelated leaves', async () => {
  const env = await integration();
  const cmd = preferencesCommands(env.data, env.identity);
  env.data.queryClient.setQueryData(
    queryKeys.datePreferences(env.identity),
    saved,
  );
  env.respond(() => Promise.resolve(json({ message: 'invalid' }, 400)));
  await cmd.chooseTheme('dark');
  assert.equal(cmd.getSnapshot().preview, null);
  assert.equal(cmd.getSnapshot().saved, false);
  assert.deepEqual(
    env.data.queryClient.getQueryData(queryKeys.datePreferences(env.identity)),
    saved,
  );
  env.dispose();
});
test('ambiguous PATCH remains locked after GET and same account reauthentication', async () => {
  const env = await integration();
  const identity = env.identity;
  const cmd = preferencesCommands(env.data, identity);
  env.respond((_u, init) =>
    Promise.resolve(init.method === 'PATCH' ? json({}, 503) : ok(saved)),
  );
  await cmd.chooseTheme('dark');
  assert.equal(cmd.getSnapshot().uncertain, true);
  await cmd.refresh();
  assert.equal(cmd.getSnapshot().uncertain, true);
  await assert.rejects(cmd.save({ dateFormat: 'DD/MM/YYYY' }));
  await env.manager.establishSession(loginResponse(identity.userId));
  assert.equal(
    preferencesCommands(env.data, env.identity).getSnapshot().uncertain,
    true,
  );
  env.dispose();
});
test('late old-account response cannot populate new account cache or preview', async () => {
  const env = await integration();
  const cmd = preferencesCommands(env.data, env.identity);
  let release!: (r: Response) => void;
  env.respond(() => new Promise((r) => (release = r)));
  const pending = cmd.chooseTheme('dark');
  await flush();
  await env.manager.establishSession(loginResponse(USER_B));
  release(ok({ ...saved, theme: 'dark' }));
  await pending;
  assert.equal(
    preferencesCommands(env.data, env.identity).getSnapshot().preview,
    null,
  );
  assert.equal(
    env.data.queryClient.getQueryData(queryKeys.datePreferences(env.identity)),
    undefined,
  );
  env.dispose();
});
