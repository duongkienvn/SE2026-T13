/* global jest, test, expect */
import * as SecureStore from 'expo-secure-store';
import { nativeSecureStore } from '../src/infrastructure/auth/secure-store-adapter';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'device-only',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

test('secure storage adapter forwards the device-only policy for each operation', async () => {
  await nativeSecureStore.getItemAsync('test-key');
  await nativeSecureStore.setItemAsync('test-key', 'test-value');
  await nativeSecureStore.deleteItemAsync('test-key');
  const options = { keychainAccessible: 'device-only' };
  expect(SecureStore.getItemAsync).toHaveBeenCalledWith('test-key', options);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    'test-key',
    'test-value',
    options,
  );
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('test-key', options);
});
