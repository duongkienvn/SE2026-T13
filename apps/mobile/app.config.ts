import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Kanvexa',
  slug: 'kanvexa-mobile',
  version: '0.1.0',
  scheme: 'kanvexa-dev',
  platforms: ['android', 'ios'],
  userInterfaceStyle: 'light',
  icon: './assets/brand/kanvexa-logo-v1.png',
  android: {
    package: 'tech.kanvexa.mobile.dev',
  },
  ios: {
    bundleIdentifier: 'tech.kanvexa.mobile.dev',
    supportsTablet: true,
  },
  plugins: ['expo-router'],
};

export default config;
