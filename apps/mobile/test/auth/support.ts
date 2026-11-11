import type { Clock, Timers } from '../../src/infrastructure/auth/clock.ts';
import type { SecureKeyValueStore } from '../../src/infrastructure/auth/credential-store.ts';
import type {
  SessionApi,
  SessionUser,
  VerifyResult,
} from '../../src/infrastructure/auth/session-api.ts';

export const USER_A = '11111111-1111-4111-8111-111111111111';
export const USER_B = '22222222-2222-4222-8222-222222222222';
export const START = Date.UTC(2026, 10, 10, 8, 0, 0);

function base64Url(value: string) {
  return Buffer.from(value).toString('base64url');
}

/** Unsigned test JWT with the backend's claim names. */
export function makeJwt(sub: string, tag = 'sig', exp = 1_900_000_000) {
  return [
    base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64Url(JSON.stringify({ sub, authVersion: 0, iat: 1, exp })),
    base64Url(tag),
  ].join('.');
}

export function loginResponse(sub: string, tag = 'sig', expiresIn = 3600) {
  return {
    accessToken: makeJwt(sub, tag),
    tokenType: 'Bearer',
    expiresIn,
    user: { id: sub },
  };
}

export function user(id: string): SessionUser {
  return {
    id,
    email: `${id.slice(0, 4)}@example.test`,
    displayName: 'User',
    avatarUrl: null,
  };
}

/** Fake wall clock and timers; `advance` fires due timers in order. */
export class FakeTime implements Clock, Timers {
  current = START;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { at: number; callback: () => void }
  >();

  now() {
    return this.current;
  }

  setTimeout(callback: () => void, ms: number) {
    const id = this.nextId++;
    this.pending.set(id, { at: this.current + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown) {
    this.pending.delete(handle as number);
  }

  get timerCount() {
    return this.pending.size;
  }

  advance(ms: number) {
    const target = this.current + ms;
    for (let fired = 0; ; fired += 1) {
      if (fired > 1000)
        throw new Error('timer loop: a timer keeps rescheduling itself');
      const due = [...this.pending.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.current = due[1].at;
      due[1].callback();
    }
    this.current = target;
  }

  /** Wall-clock jump without timers firing (device clock change, sleep). */
  jump(ms: number) {
    this.current += ms;
  }
}

type Fault = 'get' | 'set' | 'delete' | 'set-partial';

export class MemorySecureStore implements SecureKeyValueStore {
  readonly values = new Map<string, string>();
  readonly faults = new Set<Fault>();
  readonly calls: string[] = [];
  gate: Promise<void> | null = null;

  async getItemAsync(key: string) {
    this.calls.push('get');
    await this.gate;
    if (this.faults.has('get')) throw new Error('keychain read failed');
    return this.values.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string) {
    this.calls.push('set');
    await this.gate;
    if (this.faults.has('set')) throw new Error('keychain write failed');
    this.values.set(
      key,
      this.faults.has('set-partial') ? value.slice(0, 10) : value,
    );
  }

  async deleteItemAsync(key: string) {
    this.calls.push('delete');
    await this.gate;
    if (this.faults.has('delete')) throw new Error('keychain delete failed');
    this.values.delete(key);
  }
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Session API whose answers the test controls per call. */
export class FakeSessionApi implements SessionApi {
  readonly verifyCalls: string[] = [];
  readonly logoutCalls: string[] = [];
  readonly queued: Deferred<VerifyResult>[] = [];
  auto: ((token: string) => VerifyResult) | null = null;
  logoutResult = true;

  verify(token: string) {
    this.verifyCalls.push(token);
    if (this.auto) return Promise.resolve(this.auto(token));
    const next = deferred<VerifyResult>();
    this.queued.push(next);
    return next.promise;
  }

  async logout(token: string) {
    this.logoutCalls.push(token);
    return this.logoutResult;
  }

  answer(result: VerifyResult, index = 0) {
    const [next] = this.queued.splice(index, 1);
    if (!next) throw new Error('no pending verify call');
    next.resolve(result);
  }
}

/** Lets queued promise chains (storage queue, verify) run to completion. */
export async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((done) => setImmediate(done));
}
