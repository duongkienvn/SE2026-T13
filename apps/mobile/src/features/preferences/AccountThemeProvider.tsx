import {
  type ReactNode,
  useSyncExternalStore,
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
} from 'react';
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

type ThemeProjection = { scope: string; mode: ThemeMode };
export function AccountThemeProvider({ children }: { children: ReactNode }) {
  const session = useSessionSnapshot();
  const scope =
    session.status === 'authenticated'
      ? `${session.user.id}:${session.generation}`
      : null;
  const [projection, publish] = useState<ThemeProjection | null>(null);
  // Fence the projection during render, before a new account's effects can run.
  // Only the preference observer remounts; navigation keeps its return memory.
  const mode =
    scope !== null && projection?.scope === scope ? projection.mode : 'system';
  return (
    <Palette mode={mode}>
      {session.status === 'authenticated' && (
        <AccountPalette
          key={scope}
          scope={scope!}
          identity={{ userId: session.user.id, generation: session.generation }}
          publish={publish}
        />
      )}
      {children}
    </Palette>
  );
}
function AccountPalette({
  identity,
  scope,
  publish,
}: {
  identity: SessionIdentity;
  scope: string;
  publish(projection: ThemeProjection): void;
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
  const mode = state.preview ?? query.data?.theme ?? 'system';
  useLayoutEffect(() => publish({ scope, mode }), [publish, scope, mode]);
  return null;
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
