import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { uuid4, type PushNative, type Permission } from './contracts';

export function createNativePushAdapter(
  projectId: string,
  loadModule: () => Promise<typeof import('expo-notifications')> = () =>
    import('expo-notifications'),
): PushNative {
  let module: Promise<typeof import('expo-notifications')> | undefined;
  const capability = () => {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios')
      return 'unavailable' as const;
    if (Constants.executionEnvironment === 'storeClient')
      return 'needs-build' as const;
    if (!uuid4(projectId)) return 'setup-required' as const;
    try {
      if (
        !requireOptionalNativeModule('ExpoPushTokenManager') ||
        !requireOptionalNativeModule('ExpoNotificationPermissionsModule')
      )
        return 'needs-build' as const;
    } catch {
      return 'needs-build' as const;
    }
    return 'ready' as const;
  };
  async function load() {
    if (capability() !== 'ready') throw new Error('Native push unavailable');
    // Do not statically load SDK 58 push in Expo Go or an older native binary.
    return (module ??= loadModule());
  }
  async function channel() {
    const n = await load();
    if (Platform.OS === 'android')
      await n.setNotificationChannelAsync('kanvexa', {
        name: 'Kanvexa notifications',
        importance: n.AndroidImportance.DEFAULT,
        enableVibrate: false,
        sound: null,
        lockscreenVisibility: n.AndroidNotificationVisibility.PRIVATE,
      });
  }
  return {
    capability,
    async permission(prompt) {
      const n = await load();
      let p = await n.getPermissionsAsync();
      // Android 13 requires a channel before the explicit permission request.
      if (prompt && p.status !== 'granted' && p.canAskAgain) {
        await channel();
        p = await n.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: false, allowSound: false },
        });
      }
      const granted =
        p.status === 'granted' ||
        p.ios?.status === n.IosAuthorizationStatus.PROVISIONAL;
      return granted
        ? 'granted'
        : p.status === 'undetermined'
          ? 'undetermined'
          : ('denied' as Permission);
    },
    async token() {
      const n = await load();
      await channel(); // Only reached after granted permission and account consent.
      const token = await n.getExpoPushTokenAsync({ projectId });
      if (
        !/^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]{16,220}\]$/.test(
          token.data,
        )
      )
        throw new Error('Invalid Expo routing token');
      return token.data;
    },
    async listen(received, tapped, tokenChanged) {
      if (capability() !== 'ready') return () => {};
      const n = await load();
      n.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
      let active = true;
      const seen = new Set<string>();
      function response(r: import('expo-notifications').NotificationResponse) {
        if (!active || r.actionIdentifier !== n.DEFAULT_ACTION_IDENTIFIER)
          return;
        const id = r.notification.request.identifier;
        if (seen.has(id)) return;
        if (seen.size >= 100) seen.clear();
        seen.add(id);
        tapped(r.notification.request.content.data);
        n.clearLastNotificationResponse();
      }
      const a = n.addNotificationReceivedListener((r) => {
        if (active) received(r.request.content.data);
      });
      const b = n.addNotificationResponseReceivedListener(response);
      const c = n.addPushTokenListener(() => {
        if (active) tokenChanged();
      });
      const last = n.getLastNotificationResponse();
      if (last) response(last);
      return () => {
        active = false;
        a.remove();
        b.remove();
        c.remove();
        n.setNotificationHandler(null);
      };
    },
    async clearResponse() {
      if (capability() === 'ready')
        (await load()).clearLastNotificationResponse();
    },
  };
}
