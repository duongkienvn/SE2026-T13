import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useFocusEffect } from 'expo-router';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useSessionManager } from '../../infrastructure/auth/SessionProvider';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { useAuth, useCooldown } from '../auth/runtime';
import { availableProofs, type ProofMethod } from '../profile/email-change';
import { useAccountEnvironment } from '../profile/environment';
import { deletionCommands } from './commands';

export function useDeletion(identity: SessionIdentity) {
  const data = useMobileData(),
    manager = useSessionManager(),
    { google } = useAuth(),
    environment = useAccountEnvironment();
  const commands = useMemo(
    () => deletionCommands(data, manager, identity),
    [data, manager, identity.userId, identity.generation],
  );
  const state = useSyncExternalStore(commands.subscribe, commands.getSnapshot);
  const [confirmation, setConfirmation] = useState(''),
    [password, setPassword] = useState(''),
    [chosen, setChosen] = useState<ProofMethod>('password'),
    [review, setReview] = useState(false);
  const clear = useCallback(() => {
    setConfirmation('');
    setPassword('');
    setReview(false);
  }, []);
  useFocusEffect(
    useCallback(
      () => () => {
        clear();
        commands.leave();
      },
      [clear, commands],
    ),
  );
  useEffect(
    () => manager.addLifecycleListener({ onSessionEnd: clear }),
    [manager, clear],
  );
  useEffect(() => {
    if (environment.eligible) void commands.refresh();
    else clear();
  }, [environment.eligible, commands, clear]);
  const cooldown = useCooldown(state.until),
    methods = state.providers ? availableProofs(state.providers, !!google) : [];
  const method = methods.includes(chosen) ? chosen : methods[0];
  const valid =
    confirmation === 'DELETE' &&
    !!method &&
    (method !== 'password' ||
      (password.length > 0 && Array.from(password).length <= 128));
  return {
    ...state,
    ...environment,
    confirmation,
    password,
    method,
    methods,
    review,
    cooldown,
    dirty: !!confirmation || !!password || review,
    valid: valid && environment.eligible && !state.pending && !cooldown,
    cancel: clear,
    confirmationInput: (value: string) => {
      if (!state.pending) setConfirmation(value);
    },
    passwordInput: (value: string) => {
      if (!state.pending) setPassword(value);
    },
    choose: (value: ProofMethod) => {
      if (!state.pending) {
        setChosen(value);
        setPassword('');
        setReview(false);
      }
    },
    setReview,
    refresh: commands.refresh,
    submit() {
      if (
        !valid ||
        !method ||
        !environment.eligible ||
        state.pending ||
        cooldown
      )
        return;
      const input = { confirmation, method, password };
      clear();
      void commands.submit(input, google ?? null);
    },
  };
}
