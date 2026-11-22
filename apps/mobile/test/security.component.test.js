/* global jest, test, expect, afterEach, Response, btoa */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { SecurityScreen } from '../src/features/security/SecurityScreen';
import { ConnectedAccountsScreen } from '../src/features/security/ConnectedAccountsScreen';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { integration, json, ok } from './realtime/integration-support';
import { flush } from './auth/support';

let mockGoogle = null;
const mockFlow = { setEmail: jest.fn() };
const mockRouter = {
  back: jest.fn(),
  canGoBack: () => true,
  push: jest.fn(),
  replace: jest.fn(),
};
jest.mock('../src/features/auth/runtime', () => ({
  ...jest.requireActual('../src/features/auth/runtime'),
  useAuth: () => ({ google: mockGoogle, flow: mockFlow }),
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (fn) => jest.requireActual('react').useEffect(fn, [fn]),
  useRouter: () => mockRouter,
  useIsFocused: () => true,
  usePreventRemove: () => () => {},
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));

const noContent = () => new Response(null, { status: 204 });
const failure = (status, code) =>
  json(
    { success: false, statusCode: status, code, message: 'SECRET server text' },
    status,
  );
const NEW = 'Newpass#1';
let cleanup;
async function setup(Screen, providers, override) {
  const env = await integration();
  const requests = [];
  let status = providers;
  env.respond(async (url, init) => {
    requests.push({ url, init });
    const custom = override?.(url, init, requests);
    if (custom) return custom;
    if (url.endsWith('/linked-providers'))
      return typeof status === 'function' ? status() : ok(status);
    return null;
  });
  const view = await render(
    <SessionProvider manager={env.manager}>
      <DataProvider layer={env.data}>
        <Screen />
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
    requests,
    posts: (path) =>
      requests.filter(
        ({ url, init }) => url.endsWith(path) && init.method === 'POST',
      ),
    setProviders(next) {
      status = next;
    },
  };
}
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  mockGoogle = null;
  jest.clearAllMocks();
  onlineManager.setOnline(true);
});
async function fillPasswords(current, next = NEW, confirmation = next) {
  await fireEvent.changeText(
    await screen.findByLabelText('Current password'),
    current,
  );
  await fireEvent.changeText(screen.getByLabelText('New password'), next);
  await fireEvent.changeText(
    screen.getByLabelText('Confirm new password'),
    confirmation,
  );
}
const press = (name) => fireEvent.press(screen.getByRole('button', { name }));

test('invalid drafts never reach the network; errors follow the exact policy', async () => {
  const env = await setup(SecurityScreen, {
    hasPassword: true,
    googleLinked: false,
  });
  await fillPasswords('Old#pass1', 'weakpass', 'weakpass');
  await press('Change password');
  expect(
    screen.getByText(/8–128 characters, including an uppercase/),
  ).toBeTruthy();
  await fillPasswords('Old#pass1', NEW, 'Newpass#2');
  await press('Change password');
  expect(screen.getByText('Passwords must match.')).toBeTruthy();
  expect(env.posts('/auth/change-password')).toHaveLength(0);
  // No 2FA, sessions or login activity controls exist.
  expect(
    screen.queryByText(/two-factor|2FA|Active sessions|Login activity/i),
  ).toBeNull();
});

test('204 signs out with security-change, clears private cache and socket, sends exact body once', async () => {
  let finish;
  const env = await setup(
    SecurityScreen,
    { hasPassword: true, googleLinked: false },
    (url) =>
      url.endsWith('/auth/change-password')
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : null,
  );
  const socket = env.socket;
  const disconnects = socket.disconnects;
  await fillPasswords('Old#pass1');
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Change password' }),
    ).toBeEnabled(),
  );
  await press('Change password');
  // A second tap while in flight never sends another command.
  await press('Change password');
  expect(screen.getByText('Changing your password… Please wait.')).toBeTruthy();
  // No false success and no sign-out before the server's 204.
  expect(env.manager.getSnapshot().status).toBe('authenticated');
  expect(screen.getByLabelText('Current password').props.value).toBe('');
  await act(async () => {
    finish(noContent());
    await flush();
  });
  const posts = env.posts('/auth/change-password');
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0].init.body)).toEqual({
    currentPassword: 'Old#pass1',
    newPassword: NEW,
  });
  const state = env.manager.getSnapshot();
  expect(state.status).toBe('unauthenticated');
  expect(state.reason).toBe('security-change');
  expect(env.data.queryClient.getQueryCache().getAll()).toHaveLength(0);
  expect(socket.connected).toBe(false);
  expect(socket.disconnects).toBeGreaterThan(disconnects);
});

test('403 wrong current password keeps the session, clears secrets and never echoes server text', async () => {
  const env = await setup(
    SecurityScreen,
    { hasPassword: true, googleLinked: false },
    (url) =>
      url.endsWith('/auth/change-password')
        ? failure(403, 'CURRENT_PASSWORD_INCORRECT')
        : null,
  );
  await fillPasswords('Wrong#pass1');
  await press('Change password');
  expect(
    await screen.findByText(
      'Your current password is incorrect. Your session is still active.',
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/SECRET/)).toBeNull();
  expect(screen.getByLabelText('Current password').props.value).toBe('');
  expect(screen.getByLabelText('New password').props.value).toBe('');
  expect(env.manager.getSnapshot().status).toBe('authenticated');
});

test('429 applies a cooldown that disables the form', async () => {
  await setup(
    SecurityScreen,
    { hasPassword: true, googleLinked: false },
    (url) =>
      url.endsWith('/auth/change-password')
        ? failure(429, 'TOO_MANY_REQUESTS')
        : null,
  );
  await fillPasswords('Old#pass1');
  await press('Change password');
  expect(await screen.findByText(/Too many attempts/)).toBeTruthy();
  expect(screen.getByText(/You can try again in \d+ seconds/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Change password' }),
  ).toBeDisabled();
});

test('ambiguous response is never replayed; reconciliation 401 ends the revoked session', async () => {
  let revoked = false;
  const env = await setup(
    SecurityScreen,
    () =>
      revoked
        ? failure(401, 'UNAUTHORIZED')
        : ok({ hasPassword: true, googleLinked: false }),
    (url) => {
      if (!url.endsWith('/auth/change-password')) return null;
      revoked = true; // Server committed, but the reply is unusable.
      return ok(null);
    },
  );
  await fillPasswords('Old#pass1');
  await press('Change password');
  await act(() => flush());
  expect(env.posts('/auth/change-password')).toHaveLength(1);
  expect(env.manager.getSnapshot().status).toBe('unauthenticated');
});

test('Google-only account sees no impossible form; recovery signs out then opens forgot-password', async () => {
  const env = await setup(SecurityScreen, {
    hasPassword: false,
    googleLinked: true,
  });
  expect(await screen.findByText('No password set')).toBeTruthy();
  expect(screen.queryByLabelText('Current password')).toBeNull();
  const email = env.manager.getSnapshot().user.email;
  await press('Sign out and set a password');
  expect(env.manager.getSnapshot().status).toBe('authenticated');
  await press('Sign out');
  await act(() => flush());
  expect(env.manager.getSnapshot().status).toBe('unauthenticated');
  expect(mockFlow.setEmail).toHaveBeenCalledWith(email);
  expect(mockRouter.replace).toHaveBeenCalledWith('/forgot-password');
});

test('unknown provider state shows retry, not an optimistic password form', async () => {
  await setup(SecurityScreen, () => failure(500, 'INTERNAL_ERROR'));
  expect(
    await screen.findByText(
      /Could not check whether this account has a password/,
    ),
  ).toBeTruthy();
  expect(screen.queryByLabelText('Current password')).toBeNull();
  expect(screen.queryByRole('button', { name: /Sign out and/ })).toBeNull();
});

function fakeGoogle(result) {
  const payload = btoa(
    JSON.stringify({ aud: 'web-client', iss: 'https://accounts.google.com' }),
  ).replace(/=/g, '');
  return {
    webClientId: 'web-client',
    calls: 0,
    reset: jest.fn(async () => {}),
    requestIdToken: jest.fn(async () =>
      result === 'token'
        ? { kind: 'token', idToken: `h.${payload}.s` }
        : { kind: result },
    ),
  };
}

test('status combinations render authoritative labels without fake unlink', async () => {
  mockGoogle = fakeGoogle('token');
  await setup(ConnectedAccountsScreen, {
    hasPassword: true,
    googleLinked: true,
  });
  expect(await screen.findByLabelText('Google: Connected')).toBeTruthy();
  expect(screen.getByLabelText('Password: Set')).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: /Connect Google|Unlink|Disconnect/ }),
  ).toBeNull();
});

test('Google-only and unconfigured builds get no Connect button', async () => {
  await setup(ConnectedAccountsScreen, {
    hasPassword: true,
    googleLinked: false,
  });
  expect(await screen.findByText(/isn’t available in this build/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Connect Google' })).toBeNull();
  await cleanup();
  mockGoogle = fakeGoogle('token');
  await setup(ConnectedAccountsScreen, {
    hasPassword: false,
    googleLinked: false,
  });
  expect(await screen.findByLabelText('Password: Not set')).toBeTruthy();
  expect(screen.getByText(/Set a\s+password first/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Connect Google' })).toBeNull();
});

test('password then fresh proof links once, stays signed in and rechecks status', async () => {
  mockGoogle = fakeGoogle('token');
  const env = await setup(
    ConnectedAccountsScreen,
    { hasPassword: true, googleLinked: false },
    (url) => {
      if (!url.endsWith('/auth/google/link')) return null;
      env.setProviders({ hasPassword: true, googleLinked: true });
      return noContent();
    },
  );
  const generation = env.manager.getSnapshot().generation;
  await fireEvent.changeText(
    await screen.findByLabelText('Current password'),
    'Current#1',
  );
  await press('Connect Google');
  expect(
    await screen.findByText('Google connected. You’re still signed in.'),
  ).toBeTruthy();
  const posts = env.posts('/auth/google/link');
  expect(posts).toHaveLength(1);
  const body = JSON.parse(posts[0].init.body);
  expect(Object.keys(body).sort()).toEqual(['credential', 'password']);
  expect(body.password).toBe('Current#1');
  expect(body.credential).toMatch(/^h\./);
  expect(env.posts('/auth/google')).toHaveLength(0);
  expect(mockGoogle.reset).toHaveBeenCalled();
  const state = env.manager.getSnapshot();
  expect(state.status).toBe('authenticated');
  expect(state.generation).toBe(generation);
  expect(screen.getByLabelText('Google: Connected')).toBeTruthy();
});

test('SDK cancel sends nothing; proof 401 and 409 keep the session with distinct copy', async () => {
  mockGoogle = fakeGoogle('cancelled');
  let reply = null;
  const env = await setup(
    ConnectedAccountsScreen,
    { hasPassword: true, googleLinked: false },
    (url) => (url.endsWith('/auth/google/link') ? reply : null),
  );
  const attempt = async () => {
    await fireEvent.changeText(
      await screen.findByLabelText('Current password'),
      'Current#1',
    );
    await press('Connect Google');
    await act(() => flush());
  };
  await attempt();
  expect(screen.getByText(/canceled\. Nothing was connected/)).toBeTruthy();
  expect(env.posts('/auth/google/link')).toHaveLength(0);
  mockGoogle.requestIdToken.mockImplementation(
    fakeGoogle('token').requestIdToken,
  );
  reply = failure(401, 'INVALID_GOOGLE_CREDENTIAL');
  await attempt();
  expect(screen.getByText(/could not verify this sign-in/)).toBeTruthy();
  expect(env.manager.getSnapshot().status).toBe('authenticated');
  reply = failure(409, 'GOOGLE_ACCOUNT_CONFLICT');
  await attempt();
  expect(
    screen.getByText(/not connected to another Kanvexa account/),
  ).toBeTruthy();
  expect(env.manager.getSnapshot().status).toBe('authenticated');
  expect(screen.queryByText(/SECRET/)).toBeNull();
  expect(screen.getByLabelText('Current password').props.value).toBe('');
});
