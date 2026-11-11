import { MAX_TIMEOUT_MS, type Clock, type Timers } from './clock.ts';
import {
  credentialFromLogin,
  isUuid,
  type StoredCredential,
} from './credential-record.ts';
import type { CredentialStore } from './credential-store.ts';
import type { SessionApi, SessionUser } from './session-api.ts';

export type SignedOutReason =
  /** No credential was stored. */
  | 'no-credential'
  /** The user signed out on this device. */
  | 'signed-out'
  /** Stored value was corrupted, foreign or failed validation. */
  | 'invalid-credential'
  /** The secure store refused to read. */
  | 'storage-error'
  /** The server answered 401 for the current session. */
  | 'unauthorized'
  /** Password, email or account security change ended the session. */
  | 'security-change';

/**
 * Public session state. It never contains the access token. `generation`
 * increases whenever the credential behind the session changes, so callers
 * can tag work and drop results that belong to an older session.
 */
export type SessionSnapshot =
  | { readonly status: 'restoring'; readonly generation: number }
  | { readonly status: 'verifying'; readonly generation: number }
  | {
      readonly status: 'authenticated';
      readonly generation: number;
      readonly user: SessionUser;
      readonly expiresAt: number;
    }
  | {
      readonly status: 'unauthenticated';
      readonly generation: number;
      readonly reason: SignedOutReason;
    }
  | { readonly status: 'expired'; readonly generation: number }
  | {
      /** A credential exists but could not be checked; content stays hidden. */
      readonly status: 'offline-uncertain';
      readonly generation: number;
      readonly reason: 'network' | 'timeout' | 'server';
      readonly expiresAt: number;
    };

export type SessionStatus = SessionSnapshot['status'];

export type SessionEndReason =
  | 'signed-out'
  | 'unauthorized'
  | 'security-change'
  | 'expired'
  | 'replaced'
  | 'invalid-credential';

/**
 * Synchronous teardown/start hooks. MOB-04 cancels queries and clears private
 * cache, MOB-03 resets protected navigation and MOB-06 disconnects sockets.
 * `onSessionEnd` runs before the next state is published, so nothing old is
 * visible to the new session.
 */
export interface SessionLifecycleListener {
  onSessionEnd?(event: {
    readonly previousGeneration: number;
    readonly reason: SessionEndReason;
  }): void;
  onSessionStart?(event: {
    readonly generation: number;
    readonly userId: string;
  }): void;
}

export interface AccessCredential {
  readonly accessToken: string;
  readonly generation: number;
}

/** Subset of `LoginResponseDto` (`POST /api/auth/login`, Google exchange). */
export interface LoginResponseLike {
  readonly accessToken: unknown;
  readonly tokenType: unknown;
  readonly expiresIn: unknown;
  readonly user: { readonly id: unknown } | null | undefined;
}

export type EstablishResult =
  | {
      readonly ok: true;
      readonly user: SessionUser;
      readonly persisted: boolean;
    }
  | {
      readonly ok: false;
      readonly reason:
        'invalid-response' | 'rejected' | 'unavailable' | 'superseded';
    };

export interface LogoutResult {
  /** The server answered 204. It does not mean other devices were signed out. */
  readonly serverAcknowledged: boolean;
  readonly storageCleared: boolean;
}

export interface SessionManager {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  addLifecycleListener(listener: SessionLifecycleListener): () => void;
  /** Cold-start restore. Safe to call repeatedly; runs once. */
  start(): Promise<void>;
  establishSession(response: LoginResponseLike): Promise<EstablishResult>;
  logout(): Promise<LogoutResult>;
  /** Live bearer for a request about to be sent, or `null`. */
  getAccessCredential(): AccessCredential | null;
  isCurrent(generation: number): boolean;
  /** 401 seen by a request tagged with `generation`. Stale tags are ignored. */
  handleUnauthorized(generation: number): boolean;
  /** Server-confirmed password/email/account change that revokes tokens. */
  handleSecurityInvalidation(generation: number): boolean;
  /** Re-checks absolute expiry against the wall clock now. */
  checkExpiry(): boolean;
  /** Re-runs `/users/me` from `offline-uncertain`. */
  retryVerification(): Promise<void>;
  /** App returned to foreground (also covers clock changes while away). */
  handleForeground(): void;
  handleNetworkRestored(): void;
  dispose(): void;
}

export interface SessionManagerDeps {
  readonly store: CredentialStore;
  readonly api: SessionApi;
  readonly clock: Clock;
  readonly timers: Timers;
}

type VerifyOutcome =
  'authenticated' | 'unavailable' | 'rejected' | 'expired' | 'superseded';

interface ActiveCredential extends StoredCredential {
  persisted: boolean;
}

const CREDENTIAL_STATUSES: ReadonlySet<SessionStatus> = new Set([
  'verifying',
  'authenticated',
  'offline-uncertain',
]);

export function createSessionManager(deps: SessionManagerDeps): SessionManager {
  const { store, api, clock, timers } = deps;
  let snapshot: SessionSnapshot = { status: 'restoring', generation: 1 };
  let credential: ActiveCredential | null = null;
  let expiryTimer: unknown = null;
  let started: Promise<void> | null = null;
  let verification: Promise<VerifyOutcome> | null = null;
  let disposed = false;
  const subscribers = new Set<() => void>();
  const lifecycle = new Set<SessionLifecycleListener>();
  // Storage operations run strictly in order, so a write queued by an older
  // session cannot land after the delete queued by a later logout.
  let storageChain: Promise<unknown> = Promise.resolve();

  function enqueueStorage<T>(operation: () => Promise<T>): Promise<T> {
    const next = storageChain.then(operation, operation);
    storageChain = next.catch(() => undefined);
    return next;
  }

  function publish(next: SessionSnapshot) {
    snapshot = next;
    for (const subscriber of [...subscribers]) {
      try {
        subscriber();
      } catch {
        // A broken subscriber must not block session state for others.
      }
    }
  }

  function notifyEnd(previousGeneration: number, reason: SessionEndReason) {
    for (const listener of [...lifecycle]) {
      try {
        listener.onSessionEnd?.({ previousGeneration, reason });
      } catch {
        // Teardown must reach every owner even if one throws.
      }
    }
  }

  function notifyStart(generation: number, userId: string) {
    for (const listener of [...lifecycle]) {
      try {
        listener.onSessionStart?.({ generation, userId });
      } catch {
        // A failing starter must not leave the session half-published.
      }
    }
  }

  function clearExpiryTimer() {
    if (expiryTimer !== null) timers.clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  function scheduleExpiry() {
    clearExpiryTimer();
    if (!credential) return;
    const remaining = credential.expiresAt - clock.now();
    expiryTimer = timers.setTimeout(
      () => {
        expiryTimer = null;
        if (!checkExpiry()) scheduleExpiry();
      },
      Math.max(0, Math.min(remaining, MAX_TIMEOUT_MS)),
    );
  }

  /**
   * Ends the current credential synchronously: bump generation, run every
   * teardown hook, then publish. Storage cleanup is queued afterwards.
   */
  function endSession(
    reason: SessionEndReason,
    next: (generation: number) => SessionSnapshot,
  ): Promise<boolean> {
    const previousGeneration = snapshot.generation;
    const hadCredential = credential !== null;
    credential = null;
    verification = null;
    clearExpiryTimer();
    const generation = previousGeneration + 1;
    if (hadCredential) notifyEnd(previousGeneration, reason);
    publish(next(generation));
    return enqueueStorage(() => store.clear());
  }

  function isExpired(target: StoredCredential) {
    return clock.now() >= target.expiresAt;
  }

  function checkExpiry(): boolean {
    if (!credential || !isExpired(credential)) return false;
    void endSession('expired', (generation) => ({
      status: 'expired',
      generation,
    }));
    return true;
  }

  function becomeAuthenticated(generation: number, user: SessionUser) {
    const active = credential!;
    publish({
      status: 'authenticated',
      generation,
      user,
      expiresAt: active.expiresAt,
    });
    scheduleExpiry();
    notifyStart(generation, user.id);
  }

  /** Runs `/users/me` for the current credential and applies the answer. */
  function verifyCurrent(
    expectedUserId: string | null,
  ): Promise<VerifyOutcome> {
    const target = credential;
    if (!target) return Promise.resolve('superseded');
    const generation = snapshot.generation;
    publish({ status: 'verifying', generation });
    const run = (async (): Promise<VerifyOutcome> => {
      const result = await api.verify(target.accessToken);
      if (
        disposed ||
        snapshot.generation !== generation ||
        credential !== target
      )
        return 'superseded';
      if (isExpired(target)) {
        checkExpiry();
        return 'expired';
      }
      if (result.kind === 'unauthorized') {
        await endSession('unauthorized', (next) => ({
          status: 'unauthenticated',
          generation: next,
          reason: 'unauthorized',
        }));
        return 'rejected';
      }
      if (result.kind === 'unavailable') {
        publish({
          status: 'offline-uncertain',
          generation,
          reason: result.reason,
          expiresAt: target.expiresAt,
        });
        scheduleExpiry();
        return 'unavailable';
      }
      if (
        result.user.id !== target.subject ||
        (expectedUserId !== null && result.user.id !== expectedUserId)
      ) {
        // The token speaks for a different identity than promised.
        await endSession('invalid-credential', (next) => ({
          status: 'unauthenticated',
          generation: next,
          reason: 'invalid-credential',
        }));
        return 'rejected';
      }
      if (!target.persisted) {
        const written = await enqueueStorage(() =>
          // Re-check inside the queue: a logout may have run meanwhile.
          snapshot.generation === generation && credential === target
            ? store.write(target)
            : Promise.resolve(false),
        );
        if (snapshot.generation !== generation || credential !== target) {
          // Superseded while writing: make sure nothing of it survives.
          if (written) await enqueueStorage(() => store.clear());
          return 'superseded';
        }
        target.persisted = written;
      }
      becomeAuthenticated(generation, result.user);
      return 'authenticated';
    })().finally(() => {
      if (verification === run) verification = null;
    });
    verification = run;
    return run;
  }

  async function retryVerification(): Promise<void> {
    if (snapshot.status !== 'offline-uncertain') {
      await verification;
      return;
    }
    if (checkExpiry()) return;
    await (verification ?? verifyCurrent(null));
  }

  async function restore() {
    const generation = snapshot.generation;
    const result = await enqueueStorage(() => store.read());
    if (
      disposed ||
      snapshot.generation !== generation ||
      snapshot.status !== 'restoring'
    )
      return;
    if (
      result.kind === 'none' ||
      result.kind === 'invalid' ||
      result.kind === 'error'
    ) {
      publish({
        status: 'unauthenticated',
        generation,
        reason:
          result.kind === 'none'
            ? 'no-credential'
            : result.kind === 'invalid'
              ? 'invalid-credential'
              : 'storage-error',
      });
      return;
    }
    if (isExpired(result.credential)) {
      publish({ status: 'expired', generation });
      await enqueueStorage(() => store.clear());
      return;
    }
    credential = { ...result.credential, persisted: true };
    await verifyCurrent(null);
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },

    addLifecycleListener(listener) {
      lifecycle.add(listener);
      return () => lifecycle.delete(listener);
    },

    start() {
      started ??= restore();
      return started;
    },

    async establishSession(response) {
      const user = response.user;
      const next =
        response.tokenType === 'Bearer' && user && isUuid(user.id)
          ? credentialFromLogin(
              response.accessToken,
              response.expiresIn,
              clock.now(),
            )
          : null;
      if (!next || next.subject !== (user!.id as string).toLowerCase())
        return { ok: false, reason: 'invalid-response' };

      // Any previous credential (restore in flight, other account, expired
      // state) ends first so its teardown runs before the new identity.
      if (credential) {
        // Not awaited: the new generation must be claimed synchronously, or
        // a logout during the cleanup would be overwritten. The queued
        // clear still runs before this session's write.
        void endSession('replaced', (generation) => ({
          status: 'verifying',
          generation,
        }));
      } else {
        publish({ status: 'verifying', generation: snapshot.generation + 1 });
      }
      started ??= Promise.resolve();
      credential = { ...next, persisted: false };
      const outcome = await verifyCurrent(next.subject);
      if (outcome === 'authenticated' && snapshot.status === 'authenticated')
        return {
          ok: true,
          user: snapshot.user,
          persisted: credential?.persisted ?? false,
        };
      if (outcome === 'unavailable')
        return { ok: false, reason: 'unavailable' };
      if (outcome === 'rejected' || outcome === 'expired')
        return { ok: false, reason: 'rejected' };
      return { ok: false, reason: 'superseded' };
    },

    async logout() {
      const token = credential?.accessToken ?? null;
      const storageCleared = await endSession('signed-out', (generation) => ({
        status: 'unauthenticated',
        generation,
        reason: 'signed-out',
      }));
      // Local cleanup never waits for the network. The backend logout is
      // stateless, so success here is an acknowledgement, not a revocation.
      const serverAcknowledged = token ? await api.logout(token) : false;
      return { serverAcknowledged, storageCleared };
    },

    getAccessCredential() {
      if (snapshot.status !== 'authenticated' || !credential) return null;
      if (checkExpiry()) return null;
      return {
        accessToken: credential.accessToken,
        generation: snapshot.generation,
      };
    },

    isCurrent: (generation) => generation === snapshot.generation,

    handleUnauthorized(generation) {
      if (
        generation !== snapshot.generation ||
        !CREDENTIAL_STATUSES.has(snapshot.status)
      )
        return false;
      void endSession('unauthorized', (next) => ({
        status: 'unauthenticated',
        generation: next,
        reason: 'unauthorized',
      }));
      return true;
    },

    handleSecurityInvalidation(generation) {
      if (
        generation !== snapshot.generation ||
        !CREDENTIAL_STATUSES.has(snapshot.status)
      )
        return false;
      void endSession('security-change', (next) => ({
        status: 'unauthenticated',
        generation: next,
        reason: 'security-change',
      }));
      return true;
    },

    checkExpiry,

    retryVerification,

    handleForeground() {
      if (checkExpiry()) return;
      if (credential) scheduleExpiry();
      if (snapshot.status === 'offline-uncertain') void retryVerification();
    },

    handleNetworkRestored() {
      if (snapshot.status === 'offline-uncertain') void retryVerification();
    },

    dispose() {
      disposed = true;
      clearExpiryTimer();
      subscribers.clear();
      lifecycle.clear();
    },
  };
}
