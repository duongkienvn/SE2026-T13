/* global jest, test, expect, beforeEach */
import Constants from 'expo-constants';
import { createNativePushAdapter } from '../src/features/push/native-adapter';
const mockRequest = jest.fn(),
  mockGet = jest.fn(),
  mockChannel = jest.fn();
const mockImport = jest.fn(),
  mockToken = jest.fn(),
  mockHandler = jest.fn(),
  mockClear = jest.fn(),
  mockLast = jest.fn(),
  mockReceived = jest.fn(),
  mockResponse = jest.fn(),
  mockChanged = jest.fn();
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
    getExpoPushTokenAsync: mockToken,
    setNotificationHandler: mockHandler,
    clearLastNotificationResponse: mockClear,
    getLastNotificationResponse: mockLast,
    addNotificationReceivedListener: mockReceived,
    addNotificationResponseReceivedListener: mockResponse,
    addPushTokenListener: mockChanged,
    DEFAULT_ACTION_IDENTIFIER: 'default',
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
test('native listeners suppress foreground presentation, dedupe cold/warm taps and clean up', async () => {
  Constants.executionEnvironment = 'standalone';
  const remove = [jest.fn(), jest.fn(), jest.fn()];
  mockReceived.mockReturnValue({ remove: remove[0] });
  mockResponse.mockReturnValue({ remove: remove[1] });
  mockChanged.mockReturnValue({ remove: remove[2] });
  const response = {
    actionIdentifier: 'default',
    notification: {
      request: {
        identifier: 'same-request',
        content: {
          data: {
            notificationId: '14f2550e-9359-4c06-a642-6257cb384b53',
            url: 'https://untrusted.test',
          },
        },
      },
    },
  };
  mockLast.mockReturnValue(response);
  const received = jest.fn(),
    tapped = jest.fn(),
    changed = jest.fn();
  const adapter = createNativePushAdapter(
    '45269d99-0d21-44b6-ab8f-e73e80576fee',
    async () => jest.requireMock('expo-notifications'),
  );
  const cleanup = await adapter.listen(received, tapped, changed);
  expect(await mockHandler.mock.calls[0][0].handleNotification()).toEqual({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  });
  expect(tapped).toHaveBeenCalledTimes(1);
  mockResponse.mock.calls[0][0](response);
  expect(tapped).toHaveBeenCalledTimes(1);
  mockReceived.mock.calls[0][0](response.notification);
  mockChanged.mock.calls[0][0]();
  expect(received).toHaveBeenCalledWith(
    response.notification.request.content.data,
  );
  expect(changed).toHaveBeenCalledTimes(1);
  expect(mockClear).toHaveBeenCalledTimes(1);
  cleanup();
  remove.forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
  mockResponse.mock.calls[0][0]({
    ...response,
    notification: {
      request: {
        ...response.notification.request,
        identifier: 'after-dispose',
      },
    },
  });
  mockReceived.mock.calls[0][0](response.notification);
  mockChanged.mock.calls[0][0]();
  expect(tapped).toHaveBeenCalledTimes(1);
  expect(received).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledTimes(1);
});
test('token acquisition uses the exact EAS project and rejects native FCM credentials', async () => {
  Constants.executionEnvironment = 'standalone';
  const projectId = '45269d99-0d21-44b6-ab8f-e73e80576fee';
  const adapter = createNativePushAdapter(projectId, async () =>
    jest.requireMock('expo-notifications'),
  );
  mockToken.mockResolvedValue({ data: 'ExpoPushToken[abcdefghijklmnop]' });
  expect(await adapter.token()).toBe('ExpoPushToken[abcdefghijklmnop]');
  expect(mockToken).toHaveBeenCalledWith({ projectId });
  mockToken.mockResolvedValue({ data: 'native-fcm-token' });
  await expect(adapter.token()).rejects.toThrow('Invalid Expo routing token');
  const missingProject = createNativePushAdapter('not-a-project');
  expect(missingProject.capability()).toBe('setup-required');
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
