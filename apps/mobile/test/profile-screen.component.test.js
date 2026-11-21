/* global jest, test, expect, afterEach */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { ProfileScreen } from '../src/features/profile/ProfileScreen';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { integration, ok } from './realtime/integration-support';
import { USER_A } from './auth/support';
import { ThemeContext } from '../src/ui';
const mockBack = jest.fn(),
  mockPrevent = jest.fn();
jest.mock('expo-router', () => ({
  useFocusEffect: (callback) =>
    jest.requireActual('react').useEffect(callback, [callback]),
  useRouter: () => ({
    back: mockBack,
    canGoBack: () => true,
    push: jest.fn(),
    replace: jest.fn(),
  }),
  useIsFocused: () => true,
  usePreventRemove: (blocked, fn) => {
    mockPrevent(blocked, fn);
    return () => {};
  },
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
jest.mock('../src/features/profile/native-media', () => ({
  selectPrivatePhoto: jest.fn(async () => null),
  savePrivateAvatar: jest.fn(),
  avatarTransferPorts: {},
}));
const profile = (patch = {}) => ({
  id: USER_A,
  email: 'a@example.com',
  displayName: 'Alex',
  avatarUrl: null,
  avatarRevision: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...patch,
});
let cleanup;
async function setup(mode = 'light') {
  const env = await integration();
  let server = profile();
  env.respond(async (_url, init) => {
    if (init.method === 'PATCH')
      server = { ...server, ...JSON.parse(init.body) };
    return ok(server);
  });
  const view = await render(
    <SessionProvider manager={env.manager}>
      <DataProvider layer={env.data}>
        <ThemeContext.Provider value={mode}>
          <ProfileScreen />
        </ThemeContext.Provider>
      </DataProvider>
    </SessionProvider>,
  );
  await act(() => focusManager.setFocused(true));
  cleanup = async () => {
    await view.unmount();
    env.dispose();
  };
  return {
    ...env,
    setServer: (v) => {
      server = v;
    },
  };
}
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  onlineManager.setOnline(true);
});
test.each(['light', 'dark'])(
  'real profile validates, cancels and saves only displayName in %s',
  async (mode) => {
    const env = await setup(mode);
    expect(await screen.findByText('a@example.com')).toBeTruthy();
    expect(screen.queryByLabelText(/Bio|Timezone/)).toBeNull();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Edit profile' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Display name'), ' X ');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await fireEvent.changeText(
      screen.getByLabelText('Display name'),
      '  New Name  ',
    );
    expect(mockPrevent.mock.calls.some(([blocked]) => blocked)).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Profile saved.')).toBeTruthy();
    const writes = env.requests.filter(({ init }) => init.method === 'PATCH');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0].init.body)).toEqual({
      displayName: 'New Name',
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
    await fireEvent.changeText(
      screen.getByLabelText('Display name'),
      'Discard me',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Display name')).toBeNull();
  },
);
test('closed photo picker keeps server avatar and makes no upload request', async () => {
  const env = await setup();
  await screen.findByText('a@example.com');
  await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
  expect(env.requests.some(({ url }) => url.includes('/avatar/uploads'))).toBe(
    false,
  );
  expect(screen.queryByText('Photo updated.')).toBeNull();
});
test('offline profile stays readable with disabled mutations', async () => {
  await setup();
  await screen.findByText('a@example.com');
  await act(() => onlineManager.setOnline(false));
  expect(screen.getByText(/You’re offline/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Choose photo' })).toBeDisabled();
});
