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
import { nativeGoogleProvider } from '../features/auth/google-native';
import { WorkspaceSelectionProvider } from '../features/workspaces/WorkspaceSelection';
import { nativeTransport } from '../infrastructure/query/native-data';
import { clearPrivateAttachmentFiles } from '../features/cards/attachments/native';
import { clearPrivateAvatarFiles } from '../features/profile/native-media';
import { nativeInvitationFlow } from '../features/workspaces/invitations/flow';
import { nativePush } from '../features/push/native-runtime';
import { PushContext } from '../features/push/context';
import { PushBridge } from '../features/push/PushBridge';
import {
  defaultSessionAdapter,
  type SessionAdapter,
} from '../navigation/session';

verifySharedCompatibility();

// MOB-05 owns restore and foreground verification; MOB-03 consumes token-free state.
const sessionManager = nativeSession;
// App-lifetime cleanup also covers cold start and sessions with no Card mounted.
clearPrivateAttachmentFiles();
clearPrivateAvatarFiles();
sessionManager.addLifecycleListener({
  onSessionEnd() {
    nativeInvitationFlow.clear();
    clearPrivateAttachmentFiles();
    clearPrivateAvatarFiles();
  },
  onSessionStart: nativeInvitationFlow.bind,
});
const navigationAdapter = createNavigationSessionAdapter(sessionManager);
const authApi = createAuthApi(nativeTransport);
const onEnvironment = (state: { foreground: boolean; online: boolean }) => {
  nativeRealtime.setEnvironment(state);
  nativePush.setEnvironment(state);
};

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
        <PushBridge />
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
        google={nativeGoogleProvider}
      >
        <DataProvider layer={nativeData} onEnvironment={onEnvironment}>
          <RealtimeProvider client={nativeRealtime}>
            <WorkspaceSelectionProvider>
              <PushContext.Provider value={nativePush}>
                <NavigationRoot adapter={navigationAdapter} />
              </PushContext.Provider>
            </WorkspaceSelectionProvider>
          </RealtimeProvider>
        </DataProvider>
      </AuthProvider>
    </AuthSessionProvider>
  );
}
