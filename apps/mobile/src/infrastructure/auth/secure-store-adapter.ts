import * as SecureStore from 'expo-secure-store';
import type { SecureKeyValueStore } from './credential-store.ts';

/**
 * iOS: readable after first unlock (resume and background-returned requests
 * work) and never migrated to another device through backups. Android stores
 * values encrypted with a Keystore key and loses them on uninstall.
 * No biometric prompt (`requireAuthentication`) without product approval.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const nativeSecureStore: SecureKeyValueStore = {
  getItemAsync: (key) => SecureStore.getItemAsync(key, OPTIONS),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};
