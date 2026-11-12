// Explicit local-only smoke: real Nest REST/JWT/Socket.IO, repository doubles,
// no PostgreSQL connection or migrations. Kept outside the default unit suite.
import assert from 'node:assert/strict';
import console from 'node:console';
import { createRequire } from 'node:module';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { QueryObserver } from '@tanstack/react-query';

process.env.TS_NODE_PROJECT = fileURLToPath(
  new URL('../../../backend/tsconfig.json', import.meta.url),
);
const require = createRequire(
  new URL('../../../backend/package.json', import.meta.url),
);
require('ts-node/register');
require('reflect-metadata');
const { configureTestEnvironment, ids } =
  await import('../../../backend/test/realtime/realtime-checks.mjs');
configureTestEnvironment();
Object.assign(process.env, {
  DATABASE_HOST: '127.0.0.1',
  DATABASE_PORT: '5432',
  DATABASE_NAME: 'mobile_socket_doubles_only',
  DATABASE_USER: 'unused',
  DATABASE_PASSWORD: 'unused',
  DATABASE_SSL: 'false',
});
const { boardEventsMemorySource } =
  await import('../../../backend/test/realtime/board-events/board-events-memory-source.mjs');
const { seedBoardEvents } =
  await import('../../../backend/test/realtime/board-events/board-events-checks.mjs');
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { AppModule } = require('./src/app.module.ts');
const {
  NotificationService,
} = require('./src/api/notifications/notification.service.ts');
const { configureHttpApplication } = require('./src/http-application.ts');
const { createHttpClient } =
  await import('../../src/infrastructure/api/client.ts');
const { createCredentialStore } =
  await import('../../src/infrastructure/auth/credential-store.ts');
const { createSessionManager } =
  await import('../../src/infrastructure/auth/session-manager.ts');
const { createTransportSessionApi } =
  await import('../../src/infrastructure/auth/session-api.ts');
const { systemClock, systemTimers } =
  await import('../../src/infrastructure/auth/clock.ts');
const { MemorySecureStore } = await import('../auth/support.ts');
const { createMobileDataLayer } =
  await import('../../src/infrastructure/query/data-layer.ts');
const { createNativeRealtime } =
  await import('../../src/infrastructure/realtime/client.ts');
const { nativeSocketFactory } =
  await import('../../src/infrastructure/realtime/socket.ts');
const { queryKeys } = await import('../../src/infrastructure/query/keys.ts');
const source = boardEventsMemorySource();
await seedBoardEvents(source);
const module = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(DataSource)
  .useValue(source)
  .overrideProvider(NotificationService)
  .useValue({
    record: async () => ({ status: 'disabled' }),
    recordMany: async () => [],
  })
  .compile();
const app = module.createNestApplication();
const clients = [];
const stops = [];
async function until(condition) {
  const end = Date.now() + 12_000;
  while (!condition()) {
    if (Date.now() > end) throw new Error('Local realtime smoke timed out');
    await delay(10);
  }
}
try {
  const boards = source.getRepository('Board');
  for (const board of await boards.find())
    await boards.save({
      ...board,
      workspaceId: ids.empty,
      visibility: 'PRIVATE',
    });
  configureHttpApplication(app);
  await app.listen(0, '127.0.0.1');
  const origin = await app.getUrl();
  const http = createHttpClient({
    baseUrl: new URL(`${origin}/api`),
    allowInsecureLocal: true,
    fetch: globalThis.fetch,
  });
  const login = await http.json('/auth/login', (value) => value, {
    method: 'POST',
    body: { email: 'owner@events.test', password: 'board-events-password' },
  });
  const column = await http.json(`/boards/${ids.a}/columns`, (value) => value, {
    method: 'POST',
    accessToken: login.accessToken,
    body: { name: 'Mobile local test' },
  });
  const card = await http.json(`/boards/${ids.a}/cards`, (value) => value, {
    method: 'POST',
    accessToken: login.accessToken,
    body: { columnId: column.id, title: 'Before' },
  });
  for (let i = 0; i < 2; i++) {
    const manager = createSessionManager({
      store: createCredentialStore(new MemorySecureStore()),
      api: createTransportSessionApi(http),
      clock: systemClock,
      timers: systemTimers,
    });
    const data = createMobileDataLayer(manager, http);
    data.queryClient.setDefaultOptions({
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    });
    await manager.establishSession(login);
    const realtime = createNativeRealtime({
      manager,
      data,
      createSocket: nativeSocketFactory(origin),
    });
    clients.push({ manager, data, realtime });
    realtime.setEnvironment({ foreground: true, online: true });
    realtime.start();
    stops.push(realtime.watchBoard(ids.a));
    await until(() => realtime.getBoardSnapshot(ids.a).status === 'live');
    const identity = data.getIdentity();
    const key = queryKeys.card(identity, ids.a, card.id);
    const observer = new QueryObserver(data.queryClient, {
      queryKey: key,
      queryFn: ({ signal }) =>
        data.api.json(
          `/boards/${ids.a}/cards/${card.id}`,
          (value) => value.title,
          { identity, resourceKey: key, signal },
        ),
    });
    stops.push(observer.subscribe(() => {}));
    await until(() => data.queryClient.getQueryData(key) === 'Before');
  }
  const first = clients[0];
  const identity = first.data.getIdentity();
  const key = queryKeys.card(identity, ids.a, card.id);
  await first.data.optimistic({
    identity,
    key,
    update: () => 'After',
    mutation: () =>
      first.data.api.json(
        `/boards/${ids.a}/cards/${card.id}`,
        (value) => value.title,
        {
          identity,
          resourceKey: key,
          method: 'PATCH',
          body: { title: 'After' },
        },
      ),
  });
  const second = clients[1];
  const secondKey = queryKeys.card(second.data.getIdentity(), ids.a, card.id);
  await until(
    () => second.data.queryClient.getQueryData(secondKey) === 'After',
  );
  assert.deepEqual(second.realtime.getBoardSnapshot(ids.a).userIds, [
    ids.owner,
  ]);
  first.realtime.setEnvironment({ foreground: false, online: true });
  await http.json(`/boards/${ids.a}/cards/${card.id}`, (value) => value, {
    method: 'PATCH',
    accessToken: login.accessToken,
    body: { title: 'Missed while backgrounded' },
  });
  first.realtime.setEnvironment({ foreground: true, online: true });
  await until(() => first.realtime.getBoardSnapshot(ids.a).status === 'live');
  await until(
    () =>
      first.data.queryClient.getQueryData(key) === 'Missed while backgrounded',
  );
  console.log(
    'PASS: two native controllers / same-user sockets converge after REST edit; presence deduplicates; background resume revalidates and recovers missed change (repository doubles, no PostgreSQL)',
  );
} finally {
  stops.forEach((stop) => stop());
  clients.forEach(({ realtime, data, manager }) => {
    realtime.dispose();
    data.dispose();
    manager.dispose();
  });
  await app.close();
}
