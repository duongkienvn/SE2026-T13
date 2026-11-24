import { onlineManager } from '@tanstack/react-query';
import type { AccountDeletionBlocker } from '@kanban/shared';
import { ApiError } from '../../infrastructure/api/errors.ts';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import type { SessionManager } from '../../infrastructure/auth/session-manager.ts';
import type { MobileDataLayer } from '../../infrastructure/query/data-layer.ts';
import type { GoogleIdentityProvider } from '../auth/google-identity.ts';
import {
  availableProofs,
  freshGoogleProof,
  type Providers,
  type ProofMethod,
} from '../profile/email-change.ts';
import { createDeletionApi, deletionBody } from './api.ts';

type State = {
  pending: boolean;
  providers: Providers | null;
  error: string;
  blockers: readonly AccountDeletionBlocker[];
  until: number;
};
export type DeletionInput = {
  confirmation: string;
  method: ProofMethod;
  password: string;
};

function createCommands(
  data: MobileDataLayer,
  manager: SessionManager,
  identity: SessionIdentity,
) {
  const api = createDeletionApi(data.api, identity),
    listeners = new Set<() => void>();
  let state: State = {
    pending: false,
    providers: null,
    error: '',
    blockers: [],
    until: 0,
  };
  let active: AbortController | null = null,
    disposed = false;
  const current = () => !disposed && sameIdentity(identity, data.getIdentity());
  function publish(patch: Partial<State>) {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  }
  function check(signal: AbortSignal) {
    data.assertCurrent(identity);
    if (disposed || signal.aborted)
      throw new ApiError('aborted', { requestStarted: false });
  }
  function failure(error: unknown, method: ProofMethod) {
    if (!(error instanceof ApiError))
      return 'Verification could not be completed. Please try again later.';
    if (error.status === 429) {
      publish({
        until: Math.max(
          state.until,
          Date.now() + (error.retryAfterMs ?? 300000),
        ),
      });
      return 'Too many attempts. Wait before verifying again.';
    }
    if (error.code === 'ACCOUNT_DELETION_BLOCKED') {
      publish({ blockers: error.blockers });
      return 'Resolve these ownership and workspace requirements before trying again.';
    }
    if (error.status === 409)
      return 'Account resources changed; refresh and review before trying again.';
    if (error.code === 'GOOGLE_CANCELLED')
      return 'Google verification canceled. No deletion request was made.';
    if (error.code === 'INVALID_GOOGLE_CREDENTIAL')
      return 'Verify again with the Google account linked to this account.';
    if (error.code.startsWith('GOOGLE_') || error.status === 503)
      return 'Google verification is unavailable. Use an available password or try later in a configured native build.';
    if (error.status === 403)
      return method === 'password'
        ? 'Your current password is incorrect.'
        : 'Use the Google account linked to this account.';
    if (error.status === 400)
      return 'Enter DELETE exactly and provide one valid verification method.';
    if (error.kind === 'offline' || !onlineManager.isOnline())
      return 'You’re offline. Reconnect before continuing.';
    if (error.status === 401) return 'Your session ended. Sign in again.';
    return 'Verification could not be completed. Refresh and review before trying again.';
  }
  const unbind = data.onPrivateReset(() => {
    disposed = true;
    active?.abort();
    publish({
      pending: false,
      providers: null,
      error: '',
      blockers: [],
      until: 0,
    });
    unbind();
  });
  return {
    leave() {
      active?.abort();
      if (!state.pending) publish({ error: '', blockers: [], providers: null });
    },
    getSnapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    clear() {
      if (!state.pending) publish({ error: '', blockers: [], providers: null });
    },
    async refresh() {
      if (!current() || state.pending || Date.now() < state.until) return;
      active = new AbortController();
      const controller = active;
      publish({ pending: true, error: '', providers: null, blockers: [] });
      try {
        if (!onlineManager.isOnline())
          throw new ApiError('offline', { requestStarted: false });
        const providers = await api.providers(controller.signal);
        check(controller.signal);
        publish({ providers });
      } catch (error) {
        if (current()) publish({ error: failure(error, 'password') });
      } finally {
        if (active === controller) active = null;
        if (current()) publish({ pending: false });
      }
    },
    async submit(input: DeletionInput, google: GoogleIdentityProvider | null) {
      if (!current() || state.pending || Date.now() < state.until) return;
      const controller = new AbortController();
      active = controller;
      let attempted = false;
      // Credentials remain only on this bounded call stack, never in shared state/cache.
      let body: ReturnType<typeof deletionBody> | null = null;
      publish({ pending: true, error: '', blockers: [] });
      try {
        if (!onlineManager.isOnline())
          throw new ApiError('offline', { requestStarted: false });
        if (input.confirmation !== 'DELETE')
          throw new ApiError('http', { status: 400, requestStarted: false });
        if (input.method === 'password')
          body = deletionBody({
            confirmation: input.confirmation,
            currentPassword: input.password,
          });
        const providers = await api.providers(controller.signal);
        check(controller.signal);
        publish({ providers });
        if (!availableProofs(providers, !!google).includes(input.method))
          throw new ApiError('http', { status: 403, requestStarted: false });
        if (input.method === 'google' && google)
          body = deletionBody({
            confirmation: input.confirmation,
            googleCredential: await freshGoogleProof(google, () =>
              check(controller.signal),
            ),
          });
        check(controller.signal);
        if (
          !body ||
          !(await manager.prepareAccountDeletion(identity.generation))
        ) {
          if (current())
            publish({
              error:
                'Secure credential removal could not be verified. No deletion request was sent. Unlock the device and try again.',
            });
          return;
        }
        check(controller.signal);
        attempted = true;
        await api.delete(body, controller.signal);
        check(controller.signal);
        await manager.endAccountDeletion(identity.generation, true);
      } catch (error) {
        const definite =
          error instanceof ApiError &&
          ((error.status >= 400 && error.status < 500) ||
            (error.status === 503 &&
              error.code === 'GOOGLE_AUTH_UNAVAILABLE') ||
            error.requestStarted === false);
        if (attempted && !definite)
          await manager.endAccountDeletion(identity.generation, false);
        else if (current()) publish({ error: failure(error, input.method) });
      } finally {
        if (active === controller) active = null;
        if (current()) publish({ pending: false });
      }
    },
  };
}
const stores = new WeakMap<
  MobileDataLayer,
  { identity: SessionIdentity; commands: ReturnType<typeof createCommands> }
>();
export function deletionCommands(
  data: MobileDataLayer,
  manager: SessionManager,
  identity: SessionIdentity,
) {
  const previous = stores.get(data);
  if (previous && sameIdentity(previous.identity, identity))
    return previous.commands;
  const commands = createCommands(data, manager, identity);
  stores.set(data, { identity, commands });
  return commands;
}
