import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bindAppLifecycle,
  type AppStateLike,
} from '../../src/infrastructure/auth/app-lifecycle.ts';
import { createCredentialStore } from '../../src/infrastructure/auth/credential-store.ts';
import { toGuardSessionState } from '../../src/infrastructure/auth/guard-state.ts';
import { createSessionManager } from '../../src/infrastructure/auth/session-manager.ts';
import {
  FakeSessionApi,
  FakeTime,
  MemorySecureStore,
  USER_A,
  USER_B,
  flush,
  loginResponse,
  user,
} from './support.ts';

class FakeAppState implements AppStateLike {
  currentState = 'active';
  private listener: ((state: string) => void) | null = null;
  removed = false;

  addEventListener(_type: 'change', listener: (state: string) => void) {
    this.listener = listener;
    return {
      remove: () => {
        this.removed = true;
        this.listener = null;
      },
    };
  }

  set(state: string) {
    this.currentState = state;
    this.listener?.(state);
  }
}

test('foreground is reported once per return to active', () => {
  const appState = new FakeAppState();
  let foregrounds = 0;
  const unbind = bindAppLifecycle(
    { handleForeground: () => (foregrounds += 1) },
    appState,
  );
  appState.set('active');
  assert.equal(foregrounds, 0);
  appState.set('inactive');
  appState.set('background');
  appState.set('active');
  appState.set('active');
  assert.equal(foregrounds, 1);
  unbind();
  assert.equal(appState.removed, true);
});

test('guard state exposes no token and unlocks only when authenticated', () => {
  assert.deepEqual(
    toGuardSessionState({ status: 'restoring', generation: 1 }),
    {
      status: 'restoring',
      generation: 1,
      userId: null,
      canShowProtectedContent: false,
      isResolving: true,
      canRetry: false,
    },
  );
  assert.equal(
    toGuardSessionState({ status: 'verifying', generation: 1 }).isResolving,
    true,
  );
  const uncertain = toGuardSessionState({
    status: 'offline-uncertain',
    generation: 1,
    reason: 'network',
    expiresAt: 1,
  });
  assert.equal(uncertain.canShowProtectedContent, false);
  assert.equal(uncertain.canRetry, true);
  assert.deepEqual(
    toGuardSessionState({
      status: 'authenticated',
      generation: 4,
      user: user(USER_A),
      expiresAt: 1,
    }),
    {
      status: 'authenticated',
      generation: 4,
      userId: USER_A,
      canShowProtectedContent: true,
      isResolving: false,
      canRetry: false,
    },
  );
});

/**
 * Stand-ins for the owners that plug into the session: a generation-scoped
 * query cache (MOB-04), the protected navigation stack (MOB-03) and the
 * socket (MOB-06). They show the contract, not their real implementations.
 */
function wireOwners(manager: ReturnType<typeof createSessionManager>) {
  const cache = new Map<string, string>();
  const inFlight = new Set<AbortController>();
  const log: string[] = [];
  let socketGeneration: number | null = null;
  manager.addLifecycleListener({
    onSessionEnd: ({ previousGeneration, reason }) => {
      for (const controller of inFlight) controller.abort();
      inFlight.clear();
      cache.clear();
      socketGeneration = null;
      log.push(`reset:${reason}:${previousGeneration}`);
    },
    onSessionStart: ({ generation }) => {
      socketGeneration = generation;
      log.push(`connect:${generation}`);
    },
  });

  /** A MOB-04 style request: token at send time, generation-checked result. */
  async function request(key: string, answer: Promise<string | 401>) {
    const credential = manager.getAccessCredential();
    if (!credential) return 'blocked';
    const controller = new AbortController();
    inFlight.add(controller);
    const value = await answer;
    inFlight.delete(controller);
    if (controller.signal.aborted || !manager.isCurrent(credential.generation))
      return 'dropped';
    if (value === 401) {
      manager.handleUnauthorized(credential.generation);
      return '401';
    }
    cache.set(`${credential.generation}:${key}`, value);
    return 'stored';
  }

  return { cache, log, request, socket: () => socketGeneration, inFlight };
}

function setup() {
  const time = new FakeTime();
  const storage = new MemorySecureStore();
  const api = new FakeSessionApi();
  const manager = createSessionManager({
    store: createCredentialStore(storage),
    api,
    clock: time,
    timers: time,
  });
  return { manager, api, time, storage, owners: wireOwners(manager) };
}

async function signIn(
  manager: ReturnType<typeof createSessionManager>,
  api: FakeSessionApi,
  id: string,
) {
  api.auto = () => ({ kind: 'verified', user: user(id) });
  const result = await manager.establishSession(
    loginResponse(id, id.slice(0, 4)),
  );
  assert.equal(result.ok, true);
}

test('account switch aborts old work and a late answer cannot repopulate the cache', async () => {
  const { manager, api, owners } = setup();
  await manager.start();
  await signIn(manager, api, USER_A);
  let releaseOld!: (value: string) => void;
  const oldBoard = owners.request(
    'board',
    new Promise<string>((resolve) => (releaseOld = resolve)),
  );
  assert.equal(owners.inFlight.size, 1);

  await signIn(manager, api, USER_B);
  assert.equal(owners.inFlight.size, 0);
  releaseOld('A private board');
  assert.equal(await oldBoard, 'dropped');
  assert.equal(owners.cache.size, 0);
  assert.deepEqual(owners.log, ['connect:2', 'reset:replaced:2', 'connect:3']);
  assert.equal(owners.socket(), 3);
});

test('late 401 from the previous account does not sign out the new one', async () => {
  const { manager, api, owners } = setup();
  await manager.start();
  await signIn(manager, api, USER_A);
  let releaseOld!: (value: 401) => void;
  const old = owners.request(
    'cards',
    new Promise<401>((resolve) => (releaseOld = resolve)),
  );
  await signIn(manager, api, USER_B);
  releaseOld(401);
  assert.equal(await old, 'dropped');
  assert.equal(manager.getSnapshot().status, 'authenticated');

  assert.equal(await owners.request('cards', Promise.resolve(401)), '401');
  assert.equal(manager.getSnapshot().status, 'unauthenticated');
  assert.equal(owners.socket(), null);
});

test('expiry and logout block requests and tear down sockets', async () => {
  const { manager, api, time, owners, storage } = setup();
  await manager.start();
  await signIn(manager, api, USER_A);
  assert.equal(await owners.request('home', Promise.resolve('ok')), 'stored');
  time.advance(3_600_000);
  assert.equal(await owners.request('home', Promise.resolve('ok')), 'blocked');
  assert.equal(owners.cache.size, 0);
  assert.equal(owners.socket(), null);
  assert.equal(owners.log.at(-1), 'reset:expired:2');

  await signIn(manager, api, USER_A);
  await manager.logout();
  await flush();
  assert.equal(await owners.request('home', Promise.resolve('ok')), 'blocked');
  assert.equal(owners.log.at(-1), 'reset:signed-out:4');
  assert.equal(storage.values.size, 0);
});
