import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../infrastructure/api/errors';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useSessionManager } from '../../infrastructure/auth/SessionProvider';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { useAuth, useCooldown } from '../auth/runtime';
import { freshGoogleProof } from '../profile/email-change';
import { useAccountEnvironment } from '../profile/environment';
import {
  canRetryWorkspace,
  useWorkspaceRetryReady,
} from '../workspaces/status';
import {
  changePasswordError,
  createSecurityApi,
  googleLinkError,
  isAmbiguous,
  linkedProvidersKey,
  passwordDraftErrors,
  type PasswordDraft,
} from './api';

const EMPTY: PasswordDraft = {
  currentPassword: '',
  newPassword: '',
  confirmation: '',
};

function cooldownUntil(error: unknown): number {
  const delay =
    error instanceof ApiError && Number.isFinite(error.retryAfterMs)
      ? Math.max(60_000, error.retryAfterMs!)
      : 60_000;
  return Date.now() + delay;
}

/** Authoritative provider status. Unknown stays unknown: no optimistic default. */
export function useLinkedProviders(identity: SessionIdentity, paused = false) {
  const data = useMobileData(),
    { online, eligible } = useAccountEnvironment();
  const api = createSecurityApi(data.api, identity);
  const query = useQuery({
    queryKey: linkedProvidersKey(identity),
    queryFn: ({ signal }) => api.providers(signal),
    enabled: ({ state }) =>
      eligible &&
      !paused &&
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    staleTime: 0,
    retry: false,
  });
  const ready = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  return {
    query,
    online,
    eligible,
    api,
    refresh() {
      if (!eligible || !ready) return Promise.resolve();
      return query.refetch({ cancelRefetch: false }).then(() => undefined);
    },
  };
}

/** Clears secrets on blur and whenever the session that owned them ends. */
function useSecretLifecycle(clear: () => void, onSessionEnd?: () => void) {
  const manager = useSessionManager(),
    alive = useRef(true);
  const latest = useRef({ clear, onSessionEnd });
  latest.current = { clear, onSessionEnd };
  useEffect(() => {
    alive.current = true;
    const stop = manager.addLifecycleListener({
      onSessionEnd: () => {
        latest.current.onSessionEnd?.();
        latest.current.clear();
      },
    });
    return () => {
      alive.current = false;
      stop();
    };
  }, [manager]);
  useFocusEffect(useCallback(() => () => latest.current.clear(), []));
  return alive;
}

export function useChangePassword(identity: SessionIdentity) {
  const data = useMobileData(),
    manager = useSessionManager(),
    providers = useLinkedProviders(identity);
  const [draft, setDraft] = useState<PasswordDraft>(EMPTY),
    [touched, setTouched] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [until, setUntil] = useState(0);
  const active = useRef(false);
  const clear = useCallback(() => {
    setDraft(EMPTY);
    setTouched(false);
  }, []);
  const alive = useSecretLifecycle(clear);
  const cooldown = useCooldown(until);
  const errors = passwordDraftErrors(draft);
  const valid = !Object.keys(errors).length;
  const hasPassword = providers.query.data?.hasPassword;
  const blocked =
    pending ||
    !providers.online ||
    hasPassword !== true ||
    !!cooldown ||
    providers.query.isFetching;
  const set = (field: keyof PasswordDraft) => (value: string) => {
    if (pending) return;
    setDraft((previous) => ({ ...previous, [field]: value }));
    setError('');
  };
  return {
    draft,
    pending,
    error,
    cooldown,
    hasPassword,
    providers,
    valid,
    blocked,
    errors: touched ? errors : {},
    dirty: !!(draft.currentPassword || draft.newPassword || draft.confirmation),
    currentPassword: set('currentPassword'),
    newPassword: set('newPassword'),
    confirmation: set('confirmation'),
    cancel() {
      if (!pending) {
        clear();
        setError('');
      }
    },
    async submit() {
      setTouched(true);
      if (active.current || blocked || !valid) return;
      active.current = true;
      setPending(true);
      setError('');
      // The secret leaves React state at once; this local reference dies with the call.
      let secret: PasswordDraft | null = draft;
      clear();
      const controller = new AbortController();
      try {
        data.assertCurrent(identity);
        await providers.api.changePassword(secret, controller.signal);
        // 204 = credential rotated. Only the session that sent it may end;
        // a late reply for User A cannot touch User B (generation fence).
        manager.handleSecurityInvalidation(identity.generation);
      } catch (failure) {
        if (!manager.isCurrent(identity.generation)) return;
        if (alive.current) {
          setError(changePasswordError(failure));
          if (failure instanceof ApiError && failure.status === 429)
            setUntil(cooldownUntil(failure));
        }
        // Unknown outcome: never replay. A rotated authVersion makes this 401.
        if (isAmbiguous(failure)) await providers.refresh();
      } finally {
        // eslint-disable-next-line no-useless-assignment
        secret = null;
        active.current = false;
        if (alive.current) setPending(false);
      }
    },
  };
}

export function useGoogleLink(identity: SessionIdentity) {
  const data = useMobileData(),
    manager = useSessionManager(),
    { google } = useAuth(),
    providers = useLinkedProviders(identity);
  const [password, setPassword] = useState(''),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [linked, setLinked] = useState(false),
    [until, setUntil] = useState(0);
  const active = useRef<AbortController | null>(null);
  const clear = useCallback(() => setPassword(''), []);
  const alive = useSecretLifecycle(clear, () => active.current?.abort());
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  const cooldown = useCooldown(until);
  const status = providers.query.data;
  const eligible =
    !!status && status.hasPassword && !status.googleLinked && !!google;
  const valid = password.length > 0 && Array.from(password).length <= 128;
  const blocked =
    pending ||
    !eligible ||
    !providers.online ||
    !!cooldown ||
    providers.query.isFetching;
  return {
    password,
    pending,
    error,
    linked,
    cooldown,
    status,
    providers,
    configured: !!google,
    eligible,
    valid,
    blocked,
    dirty: !!password,
    passwordText(value: string) {
      if (pending) return;
      setPassword(value);
      setError('');
      setLinked(false);
    },
    cancel() {
      if (!pending) {
        clear();
        setError('');
      }
    },
    async submit() {
      if (active.current || blocked || !valid || !google) return;
      const controller = new AbortController();
      active.current = controller;
      setPending(true);
      setError('');
      setLinked(false);
      // Password before OAuth UI; both secrets live only inside this call.
      let secret: string | null = password;
      clear();
      const check = () => {
        data.assertCurrent(identity);
        if (controller.signal.aborted) throw new ApiError('aborted');
      };
      try {
        // Fresh, action-specific ID token; it goes out of scope with this call.
        const credential = await freshGoogleProof(google, check);
        check();
        await providers.api.linkGoogle(credential, secret, controller.signal);
        check();
        // No session rotation on link: stay signed in and re-read the server.
        if (alive.current) setLinked(true);
        await providers.refresh();
      } catch (failure) {
        if (
          !manager.isCurrent(identity.generation) ||
          controller.signal.aborted
        )
          return;
        if (alive.current) {
          setError(googleLinkError(failure));
          if (failure instanceof ApiError && failure.status === 429)
            setUntil(cooldownUntil(failure));
        }
        if (isAmbiguous(failure)) await providers.refresh();
      } finally {
        // eslint-disable-next-line no-useless-assignment
        secret = null;
        if (active.current === controller) active.current = null;
        if (alive.current) setPending(false);
      }
    },
  };
}
