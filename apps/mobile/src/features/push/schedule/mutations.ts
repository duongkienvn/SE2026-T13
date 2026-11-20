import { onlineManager } from '@tanstack/react-query';
import type { PushSchedule, UpdatePushSchedule } from '@kanban/shared';
import { ApiError } from '../../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../../infrastructure/query/data-layer.ts';
import { scheduleKey } from './api.ts';
import { canRetryWorkspace } from '../../workspaces/status.ts';
import { createScheduleApi } from './api.ts';
import { hasPatch } from './model.ts';
import { guardScheduleCooldown, rememberScheduleFailure } from './cooldown.ts';

type State = {
  pending: 'save' | 'verify' | null;
  mustVerify: boolean;
  error: unknown;
  errorUpdatedAt: number;
};
// Only uncertainty metadata survives account changes, never preference values.
const uncertainUsers = new WeakMap<MobileDataLayer, Set<string>>();
const pendingUsers = new WeakMap<MobileDataLayer, Set<string>>();
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
function createCommands(data: MobileDataLayer, identity: SessionIdentity) {
  const api = createScheduleApi(data.api, identity),
    key = scheduleKey(identity);
  const listeners = new Set<() => void>();
  let state: State = {
    pending: null,
    mustVerify: uncertainUsers.get(data)?.has(identity.userId) ?? false,
    error: null,
    errorUpdatedAt: 0,
  };
  let active: AbortController | null = null;
  function publish(patch: Partial<State>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }
  function retainUncertainty() {
    const users = uncertainUsers.get(data) ?? new Set<string>();
    users.add(identity.userId);
    uncertainUsers.set(data, users);
    publish({ mustVerify: true });
  }
  function guard(verify: boolean) {
    guardScheduleCooldown(data, identity);
    if (uncertainUsers.get(data)?.has(identity.userId) && !state.mustVerify)
      publish({ mustVerify: true });
    if (
      state.pending ||
      (!verify &&
        (state.mustVerify || pendingUsers.get(data)?.has(identity.userId)))
    )
      throw new ApiError('http', {
        status: 409,
        code: 'SCHEDULE_REVIEW_REQUIRED',
      });
    if (!onlineManager.isOnline())
      throw new ApiError('offline', { requestStarted: false });
    if (!canRetryWorkspace(state.error, state.errorUpdatedAt))
      throw new ApiError('http', { status: 429 });
  }
  async function execute(
    kind: 'save' | 'verify',
    patch?: UpdatePushSchedule,
  ): Promise<PushSchedule> {
    guard(kind === 'verify');
    if (kind === 'save') {
      const users = pendingUsers.get(data) ?? new Set<string>();
      users.add(identity.userId);
      pendingUsers.set(data, users);
    }
    const controller = new AbortController();
    let attempted = false;
    active = controller;
    publish({ pending: kind, error: null });
    // Cancel/fence reads before writing; a pre-save response cannot replace the ACK.
    try {
      data.cancelResourceRequests(key);
      await data.queryClient.cancelQueries({ queryKey: key, exact: true });
      data.resources.bumpKey(key);
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
                mutationFn: (input: UpdatePushSchedule) => {
                  if (controller.signal.aborted)
                    throw new ApiError('aborted', { requestStarted: false });
                  data.assertCurrent(identity);
                  attempted = true;
                  return api.patch(input, controller.signal);
                },
              })
              .execute(patch!);
      data.assertCurrent(identity);
      if (controller.signal.aborted) throw new ApiError('aborted');
      // Reads may also have started while the command was pending. Fence them
      // synchronously before publishing the authoritative result.
      data.cancelResourceRequests(key);
      void data.queryClient.cancelQueries({ queryKey: key, exact: true });
      data.resources.bumpKey(key);
      data.queryClient.setQueryData(key, result);
      // GET is only an observation: it can precede the timed-out PATCH commit.
      // This API has no operation receipt/status or revision to prove settlement.
      publish({ error: null });
      return result;
    } catch (failure) {
      const error = rememberScheduleFailure(data, identity, failure);
      if (kind === 'save' && attempted && uncertain(error)) retainUncertainty();
      if (sameIdentity(identity, data.getIdentity()))
        publish({
          error,
          errorUpdatedAt: Date.now(),
        });
      throw error;
    } finally {
      if (kind === 'save') pendingUsers.get(data)?.delete(identity.userId);
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
    async save(patch: UpdatePushSchedule) {
      data.assertCurrent(identity);
      if (!hasPatch(patch)) return;
      return execute('save', patch);
    },
    verify: () => execute('verify'),
    abort() {
      active?.abort();
    },
  };
}
// Only command metadata lives across screen lifetimes. Drafts remain React-local.
// A plain GET cannot unlock an uncertain write after leaving/reopening.
const stores = new WeakMap<
  MobileDataLayer,
  {
    identity: SessionIdentity;

    commands: ReturnType<typeof createCommands>;
  }
>();
export function scheduleCommands(
  data: MobileDataLayer,
  identity: SessionIdentity,
) {
  // Lookup is called during render. Session expiry belongs to the session flow;
  // all actions/HTTP calls still assert the identity before touching data.
  const previous = stores.get(data);
  if (previous && sameIdentity(previous.identity, identity))
    return previous.commands;
  previous?.commands.abort();
  const commands = createCommands(data, identity);
  stores.set(data, { identity, commands });
  return commands;
}
