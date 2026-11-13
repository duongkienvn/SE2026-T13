import { nativeRealtime } from '../infrastructure/realtime/native-realtime';
import { RealtimeProvider } from '../infrastructure/realtime/RealtimeProvider';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { verifySharedCompatibility } from '../bootstrap/shared-compatibility';
import { nativeData, nativeSession } from '../infrastructure/query/native-data';
import { DataProvider } from '../infrastructure/query/DataProvider';
import { SessionProvider as AuthSessionProvider } from '../infrastructure/auth/SessionProvider';
import { createNavigationSessionAdapter } from '../navigation/native-session-adapter';
import { SessionProvider } from '../navigation/session-context';
import { RootStack } from '../navigation/root-stack';
import { AuthProvider } from '../features/auth/runtime';
import { createAuthApi } from '../features/auth/api';
import { nativeAuthFlow } from '../features/auth/flow';
import { WorkspaceSelectionProvider } from '../features/workspaces/WorkspaceSelection';
import { nativeTransport } from '../infrastructure/query/native-data';
import {
  defaultSessionAdapter,
  type SessionAdapter,
} from '../navigation/session';

verifySharedCompatibility();

// MOB-05 owns restore and foreground verification; MOB-03 consumes token-free state.
const sessionManager = nativeSession;
const navigationAdapter = createNavigationSessionAdapter(sessionManager);
const authApi = createAuthApi(nativeTransport);

export function NavigationRoot({
  adapter = defaultSessionAdapter,
}: {
  adapter?: SessionAdapter;
}) {
  return (
    <SafeAreaProvider>
      <SessionProvider adapter={adapter}>
        <StatusBar style="auto" />
        <RootStack />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthSessionProvider manager={sessionManager}>
      <AuthProvider
        api={authApi}
        manager={sessionManager}
        flow={nativeAuthFlow}
      >
        <DataProvider
          layer={nativeData}
          onEnvironment={nativeRealtime.setEnvironment}
        >
          <RealtimeProvider client={nativeRealtime}>
            <WorkspaceSelectionProvider>
              <NavigationRoot adapter={navigationAdapter} />
            </WorkspaceSelectionProvider>
          </RealtimeProvider>
        </DataProvider>
      </AuthProvider>
    </AuthSessionProvider>
  );
}
