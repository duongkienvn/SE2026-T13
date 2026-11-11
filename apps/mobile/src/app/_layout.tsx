import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { verifySharedCompatibility } from '../bootstrap/shared-compatibility';
import { createNativeSessionManager } from '../infrastructure/auth/native-session';
import { SessionProvider } from '../infrastructure/auth/SessionProvider';

verifySharedCompatibility();

// One session owner per app process: restores SecureStore on cold start and
// verifies `/users/me` before any protected route may render.
const sessionManager = createNativeSessionManager();

export default function RootLayout() {
  return (
    <SessionProvider manager={sessionManager}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Slot />
      </SafeAreaProvider>
    </SessionProvider>
  );
}
