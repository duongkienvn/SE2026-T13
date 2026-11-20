import type { PushPreferences, RegisterPushDevice } from '@kanban/shared';
import { ApiError } from '../../infrastructure/api/errors.ts';
import type { SessionIdentity } from '../../infrastructure/api/session-client.ts';
import { sameIdentity } from '../../infrastructure/api/session-client.ts';
import {
  pushNotificationId,
  type Capability,
  type Permission,
  type PushApi,
  type PushNative,
} from './contracts.ts';
import type { PushStorage } from './storage.ts';
export interface PushState {
  preferences?: PushPreferences;
  capability: Capability;
  permission?: Permission;
  eligible: boolean;
  busy: boolean;
  error?: string;
  uncertain: boolean;
  online: boolean;
}
interface Dependencies {
  identity(): SessionIdentity | null;
  api(identity: SessionIdentity): PushApi;
  native: PushNative;
  storage: PushStorage;
  platform: 'android' | 'ios';
  projectId: string;
  appEnvironment: RegisterPushDevice['appEnvironment'];
  refreshInbox(identity: SessionIdentity): void;
  openInbox(): void;
}
export function createPushController(deps: Dependencies) {
  let state: PushState = {
    capability: deps.native.capability(),
    eligible: false,
    busy: false,
    uncertain: false,
    online: true,
  };
  const listeners = new Set<() => void>(),
    uncertainUsers = new Set<string>(),
    savingUsers = new Set<string>();
  let epoch = 0,
    operation: AbortController | undefined,
    queued = false,
    online = true,
    foreground = true,
    suspended = false;
  let retryAt = 0,
    openInbox = deps.openInbox;
  const publish = (patch: Partial<PushState>) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  const check = (identity: SessionIdentity, version: number) => {
    if (
      suspended ||
      version !== epoch ||
      !sameIdentity(identity, deps.identity())
    )
      throw new ApiError('session-changed');
  };
  function errorText(error: unknown) {
    if (error instanceof ApiError) {
      if (error.status === 429) {
        retryAt = Date.now() + Math.max(1000, error.retryAfterMs ?? 30_000);
        return 'Too many requests. Wait before retrying push setup.';
      }
      if (error.kind === 'offline' || error.kind === 'network')
        return 'Push setup needs a connection. Reconnect and retry.';
      if (error.status === 409)
        return 'This device enrollment was revoked or changed. Sign out, sign in again, then enable on this device.';
      if (error.status === 503)
        return 'Push delivery is unavailable. Try again later.';
      if (error.kind === 'session-changed' || error.kind === 'unauthenticated')
        return '';
    }
    return 'Push setup could not be confirmed. Retry setup or check notification permissions in system settings.';
  }
  async function run(mode: 'reconcile' | 'enable' | 'disable') {
    if (operation) {
      if (mode === 'reconcile') queued = true;
      return;
    }
    const identity = deps.identity();
    if (!identity || suspended) return;
    if (!online) {
      publish({
        error: 'You’re offline. Reconnect to change push settings.',
        online: false,
      });
      return;
    }
    if (Date.now() < retryAt) {
      publish({ error: 'Too many requests. Wait before retrying push setup.' });
      return;
    }
    if (
      mode !== 'reconcile' &&
      (uncertainUsers.has(identity.userId) || savingUsers.has(identity.userId))
    )
      return;
    const version = epoch,
      abort = new AbortController();
    const hadPendingSave = savingUsers.has(identity.userId);
    operation = abort;
    const api = deps.api(identity);
    publish({
      busy: true,
      error: undefined,
      uncertain:
        uncertainUsers.has(identity.userId) || savingUsers.has(identity.userId),
    });
    let patchStarted = false,
      claimedSave = false;
    try {
      // Disabling is the first authoritative write, before device/OS work.
      if (mode === 'disable') {
        patchStarted = true;
        savingUsers.add(identity.userId);
        claimedSave = true;
        const preferences = await api.patch(false, abort.signal);
        check(identity, version);
        patchStarted = false;
        publish({ preferences, eligible: false });
        const installationId = await deps.storage.installation();
        check(identity, version);
        try {
          await api.remove(installationId, abort.signal);
        } catch {
          await deps.storage.markCleanup(identity.userId, installationId);
        }
        return;
      }
      const preferences = await api.get(abort.signal);
      check(identity, version);
      publish({
        ...(uncertainUsers.has(identity.userId) ||
        savingUsers.has(identity.userId)
          ? {}
          : { preferences }),
        capability: deps.native.capability(),
      });
      const installationId = await deps.storage.installation();
      check(identity, version);
      const cleanup = await deps.storage.pending();
      check(identity, version);
      if (cleanup?.userId === identity.userId) {
        await api.remove(cleanup.installationId, abort.signal);
        check(identity, version);
        await deps.storage.clearCleanup();
      }
      if (!preferences.deliveryAvailable) {
        publish({
          eligible: false,
          error:
            mode === 'enable'
              ? 'Push delivery is unavailable on this server.'
              : undefined,
        });
        return;
      }
      if (deps.native.capability() !== 'ready') {
        publish({ eligible: false });
        return;
      }
      const permission = await deps.native.permission(mode === 'enable');
      check(identity, version);
      publish({ permission });
      if (permission !== 'granted') {
        if (preferences.enabled) {
          await api.remove(installationId, abort.signal);
          check(identity, version);
        }
        publish({
          eligible: false,
          error:
            mode === 'enable'
              ? 'Permission denied. Allow notifications in system settings, then retry.'
              : undefined,
        });
        return;
      }
      if (
        mode === 'reconcile' &&
        (!preferences.enabled ||
          uncertainUsers.has(identity.userId) ||
          hadPendingSave ||
          savingUsers.has(identity.userId))
      ) {
        publish({ eligible: false });
        return;
      }
      const token = await deps.native.token();
      check(identity, version);
      if (
        hadPendingSave ||
        savingUsers.has(identity.userId) ||
        uncertainUsers.has(identity.userId)
      )
        return;
      await api.register(
        {
          installationId,
          expoPushToken: token,
          platform: deps.platform,
          appEnvironment: deps.appEnvironment,
          projectId: deps.projectId,
        },
        abort.signal,
      );
      check(identity, version);
      if (!preferences.enabled) {
        patchStarted = true;
        savingUsers.add(identity.userId);
        claimedSave = true;
        const saved = await api.patch(true, abort.signal);
        check(identity, version);
        publish({ preferences: saved });
        patchStarted = false;
      }
      const current = await api.current(installationId, abort.signal);
      check(identity, version);
      publish({
        eligible: current.eligible,
        error: current.eligible
          ? undefined
          : 'Device registration is not eligible. Retry setup.',
      });
    } catch (error) {
      // A GET cannot prove that a timed-out PATCH has settled. Keep the
      // uncertainty for this app-lifetime owner, even if later GETs look normal.
      if (
        patchStarted &&
        (!(error instanceof ApiError) ||
          (error.requestStarted !== false &&
            (error.kind !== 'http' || error.status >= 500)))
      ) {
        uncertainUsers.add(identity.userId);
        if (version !== epoch || !sameIdentity(identity, deps.identity()))
          return;
        publish({
          uncertain: true,
          eligible: false,
          error:
            'The push change was not confirmed. Further changes are blocked because this server cannot prove that request has finished. Checking values does not unlock changes.',
        });
      } else if (version === epoch && sameIdentity(identity, deps.identity()))
        publish({ error: errorText(error) || undefined });
    } finally {
      if (claimedSave) savingUsers.delete(identity.userId);
      if (operation === abort) operation = undefined;
      if (version === epoch) publish({ busy: false });
      if (version === epoch && queued) {
        queued = false;
        if (online && foreground && !suspended) void run('reconcile');
      }
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    reconcile: () => run('reconcile'),
    enable: () => run('enable'),
    disable: () => run('disable'),
    setEnvironment(next: { online: boolean; foreground: boolean }) {
      const wake = (!online && next.online) || (!foreground && next.foreground);
      online = next.online;
      foreground = next.foreground;
      publish({ online });
      if (wake) void run('reconcile');
    },
    sessionStarted() {
      suspended = false;
      epoch++;
      retryAt = 0;
      if (online && foreground) void run('reconcile');
    },
    sessionEnded() {
      epoch++;
      operation?.abort();
      operation = undefined;
      queued = false;
      suspended = true;
      retryAt = 0;
      state = {
        capability: deps.native.capability(),
        eligible: false,
        busy: false,
        uncertain: false,
        online,
      };
      listeners.forEach((fn) => fn());
      void deps.native.clearResponse().catch(() => {});
    },
    async beforeLogout() {
      suspended = true;
      epoch++;
      operation?.abort();
      operation = undefined;
      queued = false;
      const identity = deps.identity();
      if (!identity) return;
      const installationId = await deps.storage
        .installation()
        .catch(() => null);
      if (!installationId) return;
      await deps.storage
        .markCleanup(identity.userId, installationId)
        .catch(() => {});
      if (!online) return;
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 2000);
      try {
        await deps.api(identity).remove(installationId, abort.signal);
        await deps.storage.clearCleanup();
      } catch {
        /* bounded lease protects offline/uncertain cleanup */
      } finally {
        clearTimeout(timeout);
      }
    },
    receive(data: unknown) {
      const identity = deps.identity();
      if (!suspended && foreground && identity && pushNotificationId(data))
        deps.refreshInbox(identity);
    },
    tap(data: unknown) {
      if (suspended) return;
      if (!pushNotificationId(data)) return;
      const identity = deps.identity();
      if (identity && !suspended) deps.refreshInbox(identity);
      // Signed-out cold start is permitted to remember Inbox for after login;
      // no server fetch or resource navigation occurs from the payload.
      openInbox();
    },
    setOpenInbox(fn: () => void) {
      openInbox = fn;
    },
  };
}
export type PushController = ReturnType<typeof createPushController>;
