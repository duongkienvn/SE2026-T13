/* global jest, test, expect, afterEach */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Settings from '../src/app/(private)/settings';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { integration, ok } from './realtime/integration-support';
import { USER_A, USER_B, loginResponse } from './auth/support';
import { ThemeContext } from '../src/ui';
import { focusManager } from '@tanstack/react-query';
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useIsFocused: () => true,
}));
jest.mock('../src/features/profile/native-media', () => ({
  savePrivateAvatar: jest.fn(),
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
let cleanup;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  jest.clearAllMocks();
});
async function setup(mode = 'light') {
  const env = await integration();
  env.respond(() =>
    Promise.resolve(
      ok({
        id: env.identity.userId,
        email:
          env.identity.userId === USER_A ? 'alex@example.com' : 'b@example.com',
        displayName: env.identity.userId === USER_A ? 'Alex' : 'Bea',
        avatarUrl: null,
        avatarRevision: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }),
    ),
  );
  const view = await render(
    <SessionProvider manager={env.manager}>
      <DataProvider layer={env.data}>
        <ThemeContext.Provider value={mode}>
          <Settings />
        </ThemeContext.Provider>
      </DataProvider>
    </SessionProvider>,
  );
  await act(() => focusManager.setFocused(true));
  cleanup = async () => {
    await view.unmount();
    env.dispose();
  };
  return env;
}
test.each(['light', 'dark'])(
  'grouped authenticated Settings keeps all eight real routes in %s',
  async (mode) => {
    await setup(mode);
    await screen.findByText('alex@example.com');
    for (const name of ['Account', 'Preferences', 'Security & Data'])
      expect(screen.getByRole('header', { name })).toBeTruthy();
    for (const [label, path] of [
      ['Profile', '/profile'],
      ['Change email', '/change-email'],
      ['Notification preferences', '/notification-preferences'],
      ['Appearance', '/appearance'],
      ['Preferences', '/preferences'],
      ['Security', '/security'],
      ['Connected accounts', '/connected-accounts'],
      ['Data & Privacy', '/data-privacy'],
    ]) {
      await fireEvent.press(screen.getByRole('button', { name: label }));
      expect(mockPush).toHaveBeenLastCalledWith(path);
    }
    expect(
      screen.queryByText(/Language|Bio|2FA|Active Sessions|Login Activity/),
    ).toBeNull();
  },
);
test('account replacement removes A’s profile and Sign Out uses the secure lifecycle', async () => {
  const env = await setup();
  await screen.findByText('alex@example.com');
  await act(() => env.manager.establishSession(loginResponse(USER_B)));
  await screen.findByText('b@example.com');
  expect(screen.queryByText('alex@example.com')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  expect(env.manager.getSnapshot().status).toBe('authenticated');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Sign out of this device' }),
  );
  await waitFor(() =>
    expect(env.manager.getSnapshot().status).toBe('unauthenticated'),
  );
  expect(screen.queryByText('b@example.com')).toBeNull();
});
