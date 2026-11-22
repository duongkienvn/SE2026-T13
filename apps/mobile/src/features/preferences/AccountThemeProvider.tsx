import { type ReactNode, useSyncExternalStore, useEffect, useRef } from 'react';
import { focusManager, useQuery } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { queryKeys } from '../../infrastructure/query/keys';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import {
  ThemeContext,
  useTheme,
  palettes,
  type ThemeMode,
} from '../../ui/theme';
import {
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  canRetryWorkspace,
} from '../workspaces/status';
import { preferencesOptions } from './api';
import { preferencesCommands } from './commands';

export function AccountThemeProvider({ children }: { children: ReactNode }) {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated')
    return <Palette mode="system">{children}</Palette>;
  return (
    <AccountPalette
      key={`${session.user.id}:${session.generation}`}
      identity={{ userId: session.user.id, generation: session.generation }}
    >
      {children}
    </AccountPalette>
  );
}
function AccountPalette({
  identity,
  children,
}: {
  identity: SessionIdentity;
  children: ReactNode;
}) {
  const data = useMobileData(),
    online = useWorkspaceOnline();
  const foreground = useSyncExternalStore(
    focusManager.subscribe.bind(focusManager),
    () => focusManager.isFocused(),
  );
  const commands = preferencesCommands(data, identity);
  const state = useSyncExternalStore(commands.subscribe, commands.getSnapshot);
  const eligible = online && foreground;
  const writeReady = useWorkspaceRetryReady(state.error, state.errorUpdatedAt);
  const query = useQuery({
    ...preferencesOptions(data.api, identity),
    enabled: ({ state: read }) =>
      eligible &&
      !commands.getSnapshot().pending &&
      writeReady &&
      canRetryWorkspace(read.error, read.errorUpdatedAt),
  });
  const readReady = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  const previouslyEligible = useRef(eligible),
    wakeRequested = useRef(false);
  useEffect(() => {
    if (!eligible) {
      previouslyEligible.current = false;
      return;
    }
    if (!previouslyEligible.current) wakeRequested.current = true;
    previouslyEligible.current = true;
    if (!wakeRequested.current || state.pending || !readReady || !writeReady)
      return;
    wakeRequested.current = false;
    // Enabling a still-fresh observer alone skips the required resume read.
    // Share any read already started by another consumer rather than cancelling it.
    void query.refetch({ cancelRefetch: false });
  }, [eligible, state.pending, readReady, writeReady, query.refetch]);
  const zone = query.data?.timeZone;
  const previousZone = useRef(zone);
  useEffect(() => {
    if (zone && previousZone.current && zone !== previousZone.current)
      void data.queryClient.invalidateQueries({
        queryKey: [...queryKeys.scope(identity), 'me', 'push-schedule'],
      });
    previousZone.current = zone;
  }, [zone, data, identity.userId, identity.generation]);
  return (
    <Palette mode={state.preview ?? query.data?.theme ?? 'system'}>
      {children}
    </Palette>
  );
}
function Palette({ mode, children }: { mode: ThemeMode; children: ReactNode }) {
  return (
    <ThemeContext.Provider value={mode}>
      <Chrome>{children}</Chrome>
    </ThemeContext.Provider>
  );
}
function Chrome({ children }: { children: ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <StatusBar style={c === palettes.dark ? 'light' : 'dark'} />
      {children}
    </View>
  );
}
