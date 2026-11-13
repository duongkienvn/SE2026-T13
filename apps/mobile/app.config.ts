import type { ExpoConfig } from 'expo/config';

// Public iOS OAuth client (never a secret). Its reversed ID is the URL scheme
// the Google SDK returns to. Android needs no plugin: Google matches the
// package name + signing certificate registered for the Android client.
const iosGoogleClient =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim().match(
    /^(\d+-[A-Za-z0-9_-]+)\.apps\.googleusercontent\.com$/,
  )?.[1];

const config: ExpoConfig = {
  name: 'Kanvexa',
  slug: 'kanvexa-mobile',
  version: '0.1.0',
  scheme: 'kanvexa-dev',
  platforms: ['android', 'ios'],
  userInterfaceStyle: 'automatic',
  icon: './assets/brand/kanvexa-logo-v1.png',
  android: {
    package: 'tech.kanvexa.mobile.dev',
  },
  ios: {
    bundleIdentifier: 'tech.kanvexa.mobile.dev',
    supportsTablet: true,
  },
  plugins: [
    'expo-router',
    ...(iosGoogleClient
      ? [
          [
            '@react-native-google-signin/google-signin',
            { iosUrlScheme: `com.googleusercontent.apps.${iosGoogleClient}` },
          ] as [string, unknown],
        ]
      : []),
  ],
  extra: {
    eas: {
      projectId: '45269d99-0d21-44b6-ab8f-e73e80576fee',
    },
  },
};

export default config;
