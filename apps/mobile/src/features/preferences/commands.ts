import { onlineManager } from '@tanstack/react-query';
import { ApiError } from '../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import { preferencesApi } from './api.ts';
import { validatePatch, type Patch, type Preferences } from './model.ts';

type State = {
  pending: boolean;
  preview: Preferences['theme'] | null;
  uncertain: boolean;
  error: unknown;
  errorUpdatedAt: number;
  saved: boolean;
  retryAt: number;
};
// No values survive a session reset. Only unresolved operation metadata is retained
// per account: this API has no revision/receipt that could prove a timed-out write ended.
const uncertainUsers = new WeakMap<MobileDataLayer, Set<string>>();
function ambiguous(error: unknown) {
  return (
    !(error instanceof ApiError) ||
    (error.requestStarted !== false &&
      (error.status >= 500 ||
        [
          'network',
          'offline',
          'timeout',
          'aborted',
          'session-changed',
          'invalid-response',
        ].includes(error.kind)))
  );
}
function createCommands(data: MobileDataLayer, identity: SessionIdentity) {
  const key = queryKeys.datePreferences(identity),
    api = preferencesApi(data.api, identity),
    listeners = new Set<() => void>();
  let state: State = {
    pending: false,
    preview: null,
    uncertain: uncertainUsers.get(data)?.has(identity.userId) ?? false,
    error: null,
    errorUpdatedAt: 0,
    saved: false,
    retryAt: 0,
  };
  let desired: Preferences['theme'] | null = null,
    controller: AbortController | null = null,
    disposed = false,
    provisionalUncertainty = false;
  const current = () => !disposed && sameIdentity(identity, data.getIdentity());
  function publish(patch: Partial<State>) {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  }
  function retain() {
    const users = uncertainUsers.get(data) ?? new Set<string>();
    users.add(identity.userId);
    uncertainUsers.set(data, users);
    publish({ uncertain: true });
  }
  function guard() {
    data.assertCurrent(identity);
    if (disposed || state.uncertain || state.pending)
      throw new ApiError('http', {
        status: 409,
        code: 'PREFERENCES_REVIEW_REQUIRED',
        requestStarted: false,
      });
    if (Date.now() < state.retryAt)
      throw new ApiError('http', {
        status: 429,
        retryAfterMs: state.retryAt - Date.now(),
        requestStarted: false,
      });
    if (!onlineManager.isOnline())
      throw new ApiError('offline', { requestStarted: false });
  }
  function fence() {
    data.cancelResourceRequests(key);
    void data.queryClient.cancelQueries({ queryKey: key, exact: true });
    data.resources.bumpKey(key);
  }
  async function write(patch: Patch) {
    guard();
    validatePatch(patch);
    controller = new AbortController();
    const active = controller;
    let attempted = false;
    publish({ pending: true, error: null, saved: false });
    try {
      fence();
      await data.queryClient.cancelQueries({ queryKey: key, exact: true });
      data.assertCurrent(identity);
      if (active.signal.aborted)
        throw new ApiError('aborted', { requestStarted: false });
      attempted = true;
      const result = await api.patch(patch, active.signal);
      data.assertCurrent(identity);
      if (!current() || active.signal.aborted) throw new ApiError('aborted');
      fence();
      data.queryClient.setQueryData(key, result);
      // Quiet hours uses the saved account zone on the server. Never alter HH:mm.
      void data.queryClient.invalidateQueries({
        queryKey: [...queryKeys.scope(identity), 'me', 'push-schedule'],
      });
      publish({ saved: true });
      return result;
    } catch (error) {
      if (attempted && ambiguous(error)) retain();
      else if (provisionalUncertainty) {
        // Teardown runs before a definite 401 reaches this catch. This command
        // acquired the marker while pending; a known rejection cannot commit.
        uncertainUsers.get(data)?.delete(identity.userId);
        provisionalUncertainty = false;
        publish({ uncertain: false });
      }
      if (current())
        publish({
          error,
          errorUpdatedAt: Date.now(),
          saved: false,
          retryAt:
            error instanceof ApiError && error.status === 429
              ? Date.now() + (error.retryAfterMs ?? 60000)
              : state.retryAt,
        });
      throw error;
    } finally {
      if (controller === active) controller = null;
      publish({ pending: false });
    }
  }
  async function drain() {
    while (desired !== null && current() && !state.pending) {
      const theme = desired;
      desired = null;
      const confirmed = data.queryClient.getQueryData<Preferences>(key);
      if (confirmed?.theme === theme) {
        publish({ preview: null });
        continue;
      }
      try {
        await write({ theme });
      } catch (error) {
        // Pre-transfer guards can fail after a previous command succeeded (for
        // example reconnect loss). That earlier ACK does not confirm this choice.
        if (current())
          publish({ saved: false, error, errorUpdatedAt: Date.now() });
        if (
          state.uncertain ||
          state.retryAt > Date.now() ||
          !onlineManager.isOnline() ||
          (error instanceof ApiError && [401, 403, 404].includes(error.status))
        ) {
          desired = null;
          publish({ preview: null });
          break;
        }
      }
      if (desired === null) publish({ preview: null });
    }
  }
  const unsubscribe = data.onPrivateReset(() => {
    if (controller) {
      provisionalUncertainty = true;
      retain();
    }
    disposed = true;
    desired = null;
    controller?.abort();
    publish({ preview: null, saved: false });
    unsubscribe();
  });
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async chooseTheme(theme: Preferences['theme']) {
      if (
        !current() ||
        state.uncertain ||
        Date.now() < state.retryAt ||
        !onlineManager.isOnline()
      )
        return;
      validatePatch({ theme });
      desired = theme;
      publish({ preview: theme, saved: false });
      if (!state.pending) await drain();
    },
    async save(patch: Patch) {
      try {
        return await write(patch);
      } finally {
        if (!state.uncertain) await drain();
        else {
          desired = null;
          publish({ preview: null });
        }
      }
    },
    async refresh() {
      data.assertCurrent(identity);
      if (
        state.pending ||
        Date.now() < state.retryAt ||
        !onlineManager.isOnline()
      )
        return;
      const result = await data.queryClient.fetchQuery({
        queryKey: key,
        staleTime: 0,
        retry: false,
        queryFn: ({ signal }) => api.get(signal),
      });
      // An observation cannot establish settlement; uncertainty deliberately stays locked.
      if (current()) publish({ error: null, saved: false });
      return result;
    },
  };
}
const stores = new WeakMap<
  MobileDataLayer,
  { identity: SessionIdentity; commands: ReturnType<typeof createCommands> }
>();
export function preferencesCommands(
  data: MobileDataLayer,
  identity: SessionIdentity,
) {
  const previous = stores.get(data);
  if (previous && sameIdentity(previous.identity, identity))
    return previous.commands;
  const commands = createCommands(data, identity);
  stores.set(data, { identity, commands });
  return commands;
}
