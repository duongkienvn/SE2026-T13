/* global jest, test, expect, beforeEach */
import Constants from 'expo-constants';
import { createNativePushAdapter } from '../src/features/push/native-adapter';
const mockRequest = jest.fn(),
  mockGet = jest.fn(),
  mockChannel = jest.fn();
const mockImport = jest.fn();
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'storeClient' },
}));
jest.mock('expo', () => ({ requireOptionalNativeModule: () => ({}) }));
jest.mock('expo-notifications', () => {
  mockImport();
  return {
    getPermissionsAsync: mockGet,
    requestPermissionsAsync: mockRequest,
    setNotificationChannelAsync: mockChannel,
    AndroidImportance: { DEFAULT: 3 },
    AndroidNotificationVisibility: { PRIVATE: 0 },
    IosAuthorizationStatus: { PROVISIONAL: 3 },
  };
});
beforeEach(() => {
  jest.clearAllMocks();
  Constants.executionEnvironment = 'storeClient';
});
test('Expo Go does not import or call native push', async () => {
  const loader = jest.fn(async () => jest.requireMock('expo-notifications'));
  const adapter = createNativePushAdapter(
    '45269d99-0d21-44b6-ab8f-e73e80576fee',
    loader,
  );
  expect(adapter.capability()).toBe('needs-build');
  await adapter.listen(jest.fn(), jest.fn(), jest.fn());
  await expect(adapter.permission(true)).rejects.toThrow(
    'Native push unavailable',
  );
  expect(loader).not.toHaveBeenCalled();
  expect(mockImport).not.toHaveBeenCalled();
  expect(mockRequest).not.toHaveBeenCalled();
});
test('silent permission check never prompts, explicit action may request it', async () => {
  Constants.executionEnvironment = 'standalone';
  mockGet.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
  mockRequest.mockResolvedValue({ status: 'granted' });
  const adapter = createNativePushAdapter(
    '45269d99-0d21-44b6-ab8f-e73e80576fee',
    async () => jest.requireMock('expo-notifications'),
  );
  expect(await adapter.permission(false)).toBe('undetermined');
  expect(mockRequest).not.toHaveBeenCalled();
  expect(await adapter.permission(true)).toBe('granted');
  expect(mockRequest).toHaveBeenCalledTimes(1);
});
