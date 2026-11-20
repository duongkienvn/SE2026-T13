import { onlineManager } from '@tanstack/react-query';
import type {
  NotificationPreferences,
  UpdateNotificationPreferences,
} from '@kanban/shared';
import { ApiError } from '../../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';
import { canRetryWorkspace } from '../../workspaces/status.ts';
import { createPreferencesApi } from './api.ts';
import { hasPatch } from './model.ts';

type State = {
  pending: 'save' | 'verify' | null;
  mustVerify: boolean;
  error: unknown;
  errorUpdatedAt: number;
};
function uncertain(error: unknown) {
  return (
    !(error instanceof ApiError) ||
    (error.requestStarted !== false &&
      (error.status >= 500 ||
        [
          'timeout',
          'network',
          'offline',
          'invalid-response',
          'aborted',
          'session-changed',
        ].includes(error.kind)))
  );
}
function createCommands(
  data: MobileDataLayer,
  identity: SessionIdentity,
  emailEnabled: boolean,
) {
  const api = createPreferencesApi(data.api, identity, emailEnabled),
    key = queryKeys.notificationPreferences(identity);
  const listeners = new Set<() => void>();
  let state: State = {
    pending: null,
    mustVerify: false,
    error: null,
    errorUpdatedAt: 0,
  };
  let active: AbortController | null = null;
  function publish(patch: Partial<State>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }
  function guard(verify: boolean) {
    data.assertCurrent(identity);
    if (state.pending || (!verify && state.mustVerify))
      throw new ApiError('http', {
        status: 409,
        code: 'PREFERENCES_REVIEW_REQUIRED',
      });
    if (!onlineManager.isOnline())
      throw new ApiError('offline', { requestStarted: false });
    if (!canRetryWorkspace(state.error, state.errorUpdatedAt))
      throw new ApiError('http', { status: 429 });
  }
  async function execute(
    kind: 'save' | 'verify',
    patch?: UpdateNotificationPreferences,
  ): Promise<NotificationPreferences> {
    guard(kind === 'verify');
    const controller = new AbortController();
    active = controller;
    publish({ pending: kind, error: null });
    // Cancel/fence reads before writing; a pre-save response cannot replace the ACK.
    data.cancelResourceRequests(key);
    await data.queryClient.cancelQueries({ queryKey: key, exact: true });
    data.resources.bumpKey(key);
    try {
      const result =
        kind === 'verify'
          ? await api.get(controller.signal)
          : await data.queryClient
              .getMutationCache()
              .build(data.queryClient, {
                mutationKey: [...key, 'save'],
                retry: false,
                networkMode: 'always',
                gcTime: 0,
                mutationFn: (input: UpdateNotificationPreferences) =>
                  api.patch(input, controller.signal),
              })
              .execute(patch!);
      data.assertCurrent(identity);
      if (controller.signal.aborted) throw new ApiError('aborted');
      data.queryClient.setQueryData(key, result);
      publish({ mustVerify: false, error: null });
      return result;
    } catch (error) {
      if (sameIdentity(identity, data.getIdentity()))
        publish({
          error,
          errorUpdatedAt: Date.now(),
          mustVerify: state.mustVerify || (kind === 'save' && uncertain(error)),
        });
      throw error;
    } finally {
      if (active === controller) active = null;
      publish({ pending: null });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async save(patch: UpdateNotificationPreferences) {
      data.assertCurrent(identity);
      if (!hasPatch(patch)) return;
      return execute('save', patch);
    },
    verify: () => execute('verify'),
    abort() {
      if (state.pending === 'save') publish({ mustVerify: true });
      active?.abort();
    },
  };
}
// Only command metadata lives across screen lifetimes. Drafts remain React-local.
// An uncertain write must still require GET verification after leaving/reopening.
const stores = new WeakMap<
  MobileDataLayer,
  {
    identity: SessionIdentity;
    emailEnabled: boolean;
    commands: ReturnType<typeof createCommands>;
  }
>();
export function preferenceCommands(
  data: MobileDataLayer,
  identity: SessionIdentity,
  emailEnabled: boolean,
) {
  data.assertCurrent(identity);
  const previous = stores.get(data);
  if (
    previous &&
    sameIdentity(previous.identity, identity) &&
    previous.emailEnabled === emailEnabled
  )
    return previous.commands;
  previous?.commands.abort();
  const commands = createCommands(data, identity, emailEnabled);
  stores.set(data, { identity, emailEnabled, commands });
  return commands;
}
