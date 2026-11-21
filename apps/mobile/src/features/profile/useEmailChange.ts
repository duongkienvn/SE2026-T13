import type { EmailChangeRequest } from '@kanban/shared';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../infrastructure/api/errors';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useSessionManager } from '../../infrastructure/auth/SessionProvider';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { useAuth, useCooldown } from '../auth/runtime';
import { emailError, passwordError } from '../auth/validation';
import {
  canRetryWorkspace,
  useWorkspaceRetryReady,
} from '../workspaces/status';
import { useAccountEnvironment } from './environment';
import {
  availableProofs,
  createEmailChangeApi,
  emailChangeError,
  emailChangeKey,
  freshGoogleProof,
  type ProofMethod,
} from './email-change';
import { emailCooldown, holdEmailRequest } from './email-cooldown';

export function useEmailChange(
  identity: SessionIdentity,
  currentEmail: string,
) {
  const data = useMobileData(),
    manager = useSessionManager(),
    { google } = useAuth(),
    { online, eligible } = useAccountEnvironment();
  const api = createEmailChangeApi(data.api, identity),
    key = emailChangeKey(identity);
  const [newEmail, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [chosen, setChosen] = useState<ProofMethod>('password'),
    [pending, setPending] = useState(false),
    [accepted, setAccepted] = useState(false),
    [error, setError] = useState(''),
    [deadline, setDeadline] = useState(() => emailCooldown(data, identity)),
    [now, setNow] = useState(Date.now());
  const active = useRef<AbortController | null>(null),
    alive = useRef(true);
  const providers = useQuery({
    queryKey: [...key, 'providers'],
    queryFn: ({ signal }) => api.providers(signal),
    enabled: ({ state }) =>
      eligible &&
      !pending &&
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    staleTime: 0,
  });
  const summary = useQuery({
    queryKey: [...key, 'pending'],
    queryFn: ({ signal }) => api.pending(signal),
    enabled: ({ state }) =>
      eligible &&
      !pending &&
      canRetryWorkspace(state.error, state.errorUpdatedAt),
    staleTime: 0,
  });
  const providersReady = useWorkspaceRetryReady(
      providers.error,
      providers.errorUpdatedAt,
    ),
    summaryReady = useWorkspaceRetryReady(
      summary.error,
      summary.errorUpdatedAt,
    );
  const methods = providers.data
    ? availableProofs(providers.data, !!google)
    : [];
  const method = methods.includes(chosen) ? chosen : methods[0];
  const until = Math.max(
    deadline,
    summary.data ? Date.parse(summary.data.issuedAt) + 60_000 : 0,
  );
  const cooldown = useCooldown(until);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const expired = !!summary.data && Date.parse(summary.data.expiresAt) <= now;
  const expiredChecked = useRef('');
  useEffect(() => {
    if (
      eligible &&
      expired &&
      summary.data &&
      expiredChecked.current !== summary.data.expiresAt &&
      !pending &&
      summaryReady
    ) {
      expiredChecked.current = summary.data.expiresAt;
      void summary.refetch({ cancelRefetch: false });
    }
  }, [eligible, expired, pending, summary.data, summary.refetch, summaryReady]);
  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      const stop = manager.addLifecycleListener({
        onSessionEnd: () => {
          active.current?.abort();
          setPassword('');
          setEmail('');
        },
      });
      return () => {
        alive.current = false;
        active.current?.abort();
        active.current = null;
        setPassword('');
        setPending(false);
        stop();
        void data.queryClient.cancelQueries({
          queryKey: emailChangeKey(identity),
        });
      };
    }, [data, manager, identity.userId, identity.generation]),
  );
  const check = () => {
    data.assertCurrent(identity);
    if (!alive.current || active.current?.signal.aborted)
      throw new ApiError('aborted');
  };
  const fieldError =
    emailError(newEmail) ??
    (newEmail.trim().toLowerCase() === currentEmail.trim().toLowerCase()
      ? 'This is already your current email address.'
      : undefined);
  const valid =
    !!method &&
    !fieldError &&
    (method !== 'password' || !passwordError(password, false));
  const blocked =
    pending ||
    !eligible ||
    !!cooldown ||
    !providersReady ||
    !summaryReady ||
    providers.isFetching ||
    providers.isError;
  return {
    newEmail,
    password,
    method,
    methods,
    providers,
    summary,
    online,
    pending,
    error,
    accepted,
    cooldown,
    expired,
    now,
    valid,
    blocked,
    fieldError: newEmail ? fieldError : undefined,
    dirty: !!newEmail || !!password,
    email(value: string) {
      if (!pending) {
        setEmail(value);
        setError('');
        setAccepted(false);
      }
    },
    passwordText(value: string) {
      if (!pending) {
        setPassword(value);
        setError('');
      }
    },
    choose(value: ProofMethod) {
      if (!pending && methods.includes(value)) {
        setChosen(value);
        setPassword('');
        setError('');
      }
    },
    cancel() {
      if (pending) return;
      setEmail('');
      setPassword('');
      setError('');
    },
    async refresh() {
      if (!eligible || pending || !providersReady || !summaryReady) return;
      setNow(Date.now());
      await Promise.all([
        providers.refetch({ cancelRefetch: false }),
        summary.refetch({ cancelRefetch: false }),
      ]);
    },
    async submit() {
      if (
        blocked ||
        !valid ||
        !method ||
        active.current ||
        Date.now() < emailCooldown(data, identity)
      )
        return;
      const controller = new AbortController();
      active.current = controller;
      setPending(true);
      setError('');
      setAccepted(false);
      let proof: EmailChangeRequest | null = null;
      // Password leaves React state immediately. Proof exists only during this request.
      if (method === 'password')
        proof = { newEmail, currentPassword: password };
      setPassword('');
      let attempted = false;
      try {
        check();
        if (method === 'google') {
          if (!google)
            throw new ApiError('configuration', { requestStarted: false });
          proof = {
            newEmail,
            googleCredential: await freshGoogleProof(google, check),
          };
        }
        check();
        setDeadline(holdEmailRequest(data, identity));
        attempted = true;
        await api.request(proof!, currentEmail, controller.signal);
        check();
        setDeadline(holdEmailRequest(data, identity));
        setEmail('');
        setAccepted(true);
        await data.queryClient.invalidateQueries({
          queryKey: [...key, 'pending'],
        });
      } catch (failure) {
        if (
          alive.current &&
          manager.isCurrent(identity.generation) &&
          !controller.signal.aborted
        ) {
          setError(emailChangeError(failure, method));
          if (attempted) {
            const delay =
              failure instanceof ApiError &&
              failure.status === 429 &&
              Number.isFinite(failure.retryAfterMs)
                ? Math.max(60_000, failure.retryAfterMs!)
                : 60_000;
            setDeadline(holdEmailRequest(data, identity, delay));
          }
        }
      } finally {
        proof = null;
        if (active.current === controller) active.current = null;
        if (alive.current) {
          setPassword('');
          setPending(false);
        }
      }
    },
  };
}
