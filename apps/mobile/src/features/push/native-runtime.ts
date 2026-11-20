import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';
import {
  nativeData,
  nativeSession,
} from '../../infrastructure/query/native-data';
import { nativeSecureStore } from '../../infrastructure/auth/secure-store-adapter';
import { queryKeys } from '../../infrastructure/query/keys';
import { createPushController } from './controller';
import { createPushApi } from './api';
import { createNativePushAdapter } from './native-adapter';
import { createPushStorage } from './storage';
const projectId: unknown = Constants.expoConfig?.extra?.eas?.projectId;
const project = typeof projectId === 'string' ? projectId : '';
const configured = process.env.EXPO_PUBLIC_APP_ENVIRONMENT;
const appEnvironment =
  configured === 'production' ||
  configured === 'preview' ||
  configured === 'development'
    ? configured
    : 'development';
export const nativePushAdapter = createNativePushAdapter(project);
export const nativePush = createPushController({
  identity: nativeData.getIdentity,
  api: (identity) => createPushApi(nativeData, identity),
  native: nativePushAdapter,
  storage: createPushStorage(nativeSecureStore, randomUUID),
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
  projectId: project,
  appEnvironment,
  refreshInbox: (identity) => {
    void nativeData
      .invalidateHints(identity, [queryKeys.notifications(identity)])
      .catch(() => {});
  },
  openInbox: () => {},
});
nativeSession.addLifecycleListener({
  beforeLogout: nativePush.beforeLogout,
  onSessionEnd: nativePush.sessionEnded,
  onSessionStart: nativePush.sessionStarted,
});
