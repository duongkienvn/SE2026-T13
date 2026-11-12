import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { verifySharedCompatibility } from '../bootstrap/shared-compatibility';
import { createNativeSessionManager } from '../infrastructure/auth/native-session';
import { SessionProvider as AuthSessionProvider } from '../infrastructure/auth/SessionProvider';
import { createNavigationSessionAdapter } from '../navigation/native-session-adapter';
import { SessionProvider } from '../navigation/session-context';
import { RootStack } from '../navigation/root-stack';
import {
  defaultSessionAdapter,
  type SessionAdapter,
} from '../navigation/session';

verifySharedCompatibility();

// MOB-05 owns restore and foreground verification; MOB-03 consumes token-free state.
const sessionManager = createNativeSessionManager();
const navigationAdapter = createNavigationSessionAdapter(sessionManager);

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
      <NavigationRoot adapter={navigationAdapter} />
    </AuthSessionProvider>
  );
}
