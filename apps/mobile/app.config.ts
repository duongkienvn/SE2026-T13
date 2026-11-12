import type { ExpoConfig } from 'expo/config';

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
  plugins: ['expo-router'],
  extra: {
    eas: {
      projectId: '45269d99-0d21-44b6-ab8f-e73e80576fee',
    },
  },
};

export default config;
