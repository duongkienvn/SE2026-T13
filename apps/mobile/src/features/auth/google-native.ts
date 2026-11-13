import { Platform, TurboModuleRegistry } from 'react-native';
import { parseGoogleConfig, type GoogleClientConfig } from './google-config';
import type {
  GoogleIdentityProvider,
  GoogleProviderResult,
} from './google-identity';

type GoogleSdk = typeof import('@react-native-google-signin/google-signin');

/**
 * Expo Go and builds made before this dependency have no `RNGoogleSignin`
 * native module, and the SDK entry throws on import there. Probe first.
 */
function loadSdk(): GoogleSdk | null {
  if (!TurboModuleRegistry.get('RNGoogleSignin')) return null;
  try {
    // Lazy on purpose: a static import throws at startup without the module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-google-signin/google-signin') as GoogleSdk;
  } catch {
    return null;
  }
}

export function createGoogleProvider(
  config: GoogleClientConfig | null,
  sdk: GoogleSdk | null,
  os: string = Platform.OS,
): GoogleIdentityProvider | null {
  if (!config || !sdk) return null;
  const { GoogleSignin, isErrorWithCode, statusCodes } = sdk;
  let configured = false;
  return {
    webClientId: config.webClientId,
    async requestIdToken(): Promise<GoogleProviderResult> {
      try {
        if (!configured) {
          // ID token only: no offline access, server auth code or extra scopes.
          GoogleSignin.configure({
            webClientId: config.webClientId,
            ...(config.iosClientId ? { iosClientId: config.iosClientId } : {}),
            offlineAccess: false,
          });
          configured = true;
        }
        if (os === 'android')
          await GoogleSignin.hasPlayServices({
            showPlayServicesUpdateDialog: true,
          });
        const response = await GoogleSignin.signIn();
        if (response.type !== 'success') return { kind: 'cancelled' };
        const idToken = response.data.idToken;
        return typeof idToken === 'string' && idToken
          ? { kind: 'token', idToken }
          : { kind: 'failed' };
      } catch (error) {
        // Never surface SDK messages: they can include account details.
        if (isErrorWithCode(error)) {
          if (error.code === statusCodes.SIGN_IN_CANCELLED)
            return { kind: 'cancelled' };
          if (error.code === statusCodes.IN_PROGRESS) return { kind: 'busy' };
          if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE)
            return { kind: 'play-services' };
        }
        return { kind: 'failed' };
      }
    },
    async reset() {
      if (!configured) return;
      try {
        await GoogleSignin.signOut();
      } catch {
        // Best effort: the Kanvexa session never depends on SDK state.
      }
    },
  };
}

const nativeConfig = parseGoogleConfig(
  {
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  },
  Platform.OS,
);
/** `null` (no Google action) without public config or the native module. */
export const nativeGoogleProvider = nativeConfig
  ? createGoogleProvider(nativeConfig, loadSdk())
  : null;
