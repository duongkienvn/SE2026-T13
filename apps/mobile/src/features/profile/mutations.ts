import { onlineManager } from '@tanstack/react-query';
import { ApiError } from '../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import { createProfileApi, profileKey } from './api.ts';
import type { Profile } from './model.ts';
import { createAvatarApi } from './avatar-api.ts';

type AvatarRecovery =
  | { kind: 'complete'; uploadId: string; baseRevision: number }
  | { kind: 'remove'; expectedRevision: number };

function terminalAvatarFailure(error: unknown, receipt: AvatarRecovery) {
  if (!(error instanceof ApiError)) return false;
  // UNAVAILABLE can mean another completion is processing. A GET cannot prove
  // it settled; only these backend outcomes rule out a future commit.
  return (
    (error.status === 409 && error.code === 'AVATAR_CHANGED') ||
    (receipt.kind === 'complete' &&
      ((error.status === 409 && error.code === 'AVATAR_UPLOAD_EXPIRED') ||
        (error.status === 404 && error.code === 'AVATAR_UPLOAD_NOT_FOUND')))
  );
}

type State = {
  pending: string | null;
  uncertain: boolean;
  error: unknown;
  retryAt: number;
  observation: Profile | null;
  recovery: AvatarRecovery | null;
};
/** No API receipt exists for PATCH. Keep only user IDs blocked across reauthentication. */
const uncertainUsers = new WeakMap<MobileDataLayer, Set<string>>();
const pendingUsers = new WeakMap<MobileDataLayer, Set<string>>();
export function ambiguous(error: unknown) {
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
  const api = createProfileApi(data.api, identity),
    key = profileKey(identity),
    listeners = new Set<() => void>();
  let state: State = {
    pending: null,
    uncertain: uncertainUsers.get(data)?.has(identity.userId) ?? false,
    error: null,
    retryAt: 0,
    observation: null,
    recovery: null,
  };
  let active: AbortController | null = null;
  const publish = (patch: Partial<State>) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  const stop = data.onPrivateReset(() => {
    active?.abort();
    publish({ observation: null, recovery: null, error: null });
  });
  function fenceReads() {
    data.cancelResourceRequests(key);
    void data.queryClient.cancelQueries({ queryKey: key, exact: true });
    data.resources.bumpKey(key);
  }
  function adopt(user: Profile) {
    data.assertCurrent(identity);
    if (user.id !== identity.userId) throw new ApiError('invalid-response');
    fenceReads();
    data.adoptUser(identity, user);
    data.queryClient.setQueryData(key, user);
  }
  const commands = {
    getSnapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    abort() {
      active?.abort();
    },
    dispose() {
      active?.abort();
      stop();
    },
    rememberAvatar(recovery: AvatarRecovery) {
      data.assertCurrent(identity);
      publish({ recovery });
    },
    retryAvatar() {
      const receipt = state.recovery;
      if (!receipt) throw new ApiError('aborted', { requestStarted: false });
      return commands.run(
        'verify photo',
        async (_api, signal) => {
          const avatar = createAvatarApi(data.api, identity);
          const result =
            receipt.kind === 'complete'
              ? await avatar.complete(receipt.uploadId, signal)
              : await avatar.remove(receipt.expectedRevision, signal);
          if (
            receipt.kind === 'complete'
              ? result.avatarRevision <= receipt.baseRevision ||
                result.avatarUrl !==
                  `/users/${identity.userId}/avatar/${receipt.uploadId}`
              : result.avatarRevision <= receipt.expectedRevision ||
                result.avatarUrl !== null
          )
            throw new ApiError('invalid-response');
          return result;
        },
        true,
      );
    },
    async refresh(signal: AbortSignal) {
      data.assertCurrent(identity);
      if (state.pending || Date.now() < state.retryAt)
        throw new ApiError('aborted', { requestStarted: false });
      const user = await api.get(signal);
      data.assertCurrent(identity);
      if (signal.aborted) throw new ApiError('aborted');
      if (state.uncertain) publish({ observation: user });
      else adopt(user);
      return user;
    },
    async run(
      kind: string,
      action: (
        api: ReturnType<typeof createProfileApi>,
        signal: AbortSignal,
      ) => Promise<Profile>,
      recovering = false,
    ) {
      data.assertCurrent(identity);
      if (
        state.pending ||
        ((state.uncertain || uncertainUsers.get(data)?.has(identity.userId)) &&
          !(recovering && state.recovery)) ||
        pendingUsers.get(data)?.has(identity.userId)
      )
        throw new ApiError('http', {
          status: 409,
          code: 'PROFILE_REVIEW_REQUIRED',
          requestStarted: false,
        });
      if (Date.now() < state.retryAt)
        throw new ApiError('http', { status: 429, requestStarted: false });
      if (!onlineManager.isOnline())
        throw new ApiError('offline', { requestStarted: false });
      const users = pendingUsers.get(data) ?? new Set<string>();
      pendingUsers.set(data, users);
      users.add(identity.userId);
      active = new AbortController();
      const controller = active;
      publish({
        pending: kind,
        error: null,
        ...(!recovering ? { recovery: null } : {}),
      });
      fenceReads();
      try {
        const result = await action(api, controller.signal);
        data.assertCurrent(identity);
        if (controller.signal.aborted) throw new ApiError('aborted');
        adopt(result);
        uncertainUsers.get(data)?.delete(identity.userId);
        publish({ uncertain: false, recovery: null, observation: null });
        return result;
      } catch (error) {
        if (
          state.recovery &&
          terminalAvatarFailure(error, state.recovery) &&
          sameIdentity(identity, data.getIdentity()) &&
          !controller.signal.aborted
        ) {
          uncertainUsers.get(data)?.delete(identity.userId);
          publish({ uncertain: false, recovery: null, observation: null });
          try {
            const current = await api.get(controller.signal);
            if (controller.signal.aborted) throw new ApiError('aborted');
            adopt(current);
          } catch {
            // Keep the terminal rejection truthful. Entry/manual revalidation
            // can retry a failed read, and all writes still preflight the user.
            if (sameIdentity(identity, data.getIdentity()))
              void data.queryClient.invalidateQueries({
                queryKey: key,
                exact: true,
                refetchType: 'none',
              });
          }
        } else if (ambiguous(error)) {
          const users = uncertainUsers.get(data) ?? new Set<string>();
          users.add(identity.userId);
          uncertainUsers.set(data, users);
          publish({ uncertain: true });
        }
        if (sameIdentity(identity, data.getIdentity())) {
          const delay =
            error instanceof ApiError && error.status === 429
              ? Math.max(
                  60_000,
                  Number.isFinite(error.retryAfterMs)
                    ? error.retryAfterMs!
                    : 60_000,
                )
              : 0;
          publish({
            error,
            retryAt: delay ? Date.now() + delay : state.retryAt,
          });
        }
        throw error;
      } finally {
        users.delete(identity.userId);
        if (active === controller) active = null;
        publish({ pending: null });
      }
    },
  };
  return commands;
}
const stores = new WeakMap<
  MobileDataLayer,
  { identity: SessionIdentity; commands: ReturnType<typeof createCommands> }
>();
export function profileCommands(
  data: MobileDataLayer,
  identity: SessionIdentity,
) {
  const previous = stores.get(data);
  if (previous && sameIdentity(previous.identity, identity))
    return previous.commands;
  previous?.commands.dispose();
  const commands = createCommands(data, identity);
  stores.set(data, { identity, commands });
  return commands;
}
