/* global jest, test, expect, afterEach */
import { URL } from 'node:url';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { NotificationPreferencesScreen } from '../src/features/notifications/preferences/NotificationPreferencesScreen';
import { createHttpClient } from '../src/infrastructure/api/client';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { createSessionManager } from '../src/infrastructure/auth/session-manager';
import { createCredentialStore } from '../src/infrastructure/auth/credential-store';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { createMobileDataLayer } from '../src/infrastructure/query/data-layer';
import { ThemeContext } from '../src/ui';
import {
  FakeSessionApi,
  FakeTime,
  MemorySecureStore,
  USER_A,
  USER_B,
  loginResponse,
  user,
} from './auth/support';
import { defaults } from './notifications/preferences-fixtures';

let mockEmailEnabled = false;
const mockBack = jest.fn(),
  mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    canGoBack: () => true,
    replace: mockReplace,
  }),
  useIsFocused: () => true,
  usePreventRemove: () => () => {},
}));
jest.mock('../src/features/notifications/preferences/config', () => ({
  get emailEnabled() {
    return mockEmailEnabled;
  },
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
function wire(data, status = 200, retryAfter = null) {
  return {
    ok: status === 200,
    status,
    headers: {
      get: (name) =>
        name === 'content-type'
          ? 'application/json'
          : name === 'retry-after'
            ? retryAfter
            : null,
    },
    text: async () =>
      JSON.stringify({
        success: status === 200,
        statusCode: status,
        message: 'OK',
        data,
      }),
  };
}
async function setup(override, mode = 'light') {
  const clock = new FakeTime(),
    auth = new FakeSessionApi();
  auth.auto = (token) => ({
    kind: 'verified',
    user: user(token === loginResponse(USER_A).accessToken ? USER_A : USER_B),
  });
  const manager = createSessionManager({
    store: createCredentialStore(new MemorySecureStore()),
    api: auth,
    clock,
    timers: clock,
  });
  await manager.establishSession(loginResponse(USER_A));
  let server = defaults();
  const requests = [];
  const data = createMobileDataLayer(
    manager,
    createHttpClient({
      baseUrl: new URL('https://preferences.example.test/api'),
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        const custom = override?.(init, server);
        if (custom) return custom;
        if (init.method === 'PATCH') {
          const patch = JSON.parse(init.body);
          server = {
            inApp: { ...server.inApp, ...patch.inApp },
            email: { ...server.email, ...patch.email },
          };
        }
        return wire(server);
      },
    }),
  );
  data.queryClient.setDefaultOptions({
    ...data.queryClient.getDefaultOptions(),
    queries: {
      ...data.queryClient.getDefaultOptions().queries,
      gcTime: Infinity,
    },
  });
  const view = await render(
    <SessionProvider manager={manager}>
      <DataProvider layer={data}>
        <ThemeContext.Provider value={mode}>
          <NotificationPreferencesScreen />
        </ThemeContext.Provider>
      </DataProvider>
    </SessionProvider>,
  );
  await act(() => focusManager.setFocused(true));
  return {
    data,
    manager,
    requests,
    get server() {
      return server;
    },
    dispose: async () => {
      await view.unmount();
      data.dispose();
      manager.dispose();
    },
  };
}
const press = async (name) =>
  fireEvent.press(await screen.findByRole('button', { name }));
const toggle = async (name) =>
  fireEvent(await screen.findByRole('switch', { name }), 'valueChange', false);
afterEach(() => {
  mockEmailEnabled = false;
  onlineManager.setOnline(true);
  focusManager.setFocused(true);
  jest.useRealTimers();
});

test('authoritative loading/error retry shows no default switches', async () => {
  let finish;
  const env = await setup(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  try {
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.getByText('Loading notification preferences…')).toBeTruthy();
    await act(async () => finish(wire({}, 500)));
    await screen.findByText(
      'Couldn’t load notification preferences. Try again.',
    );
    await press('Retry preferences');
    await act(async () => finish(wire(defaults())));
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(9));
  } finally {
    await env.dispose();
  }
});

test('exactly nine accessible values, disabled email, draft-only editing, Cancel and sparse Save', async () => {
  const env = await setup();
  try {
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(9));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(
      screen.getByRole('switch', { name: 'Email: Card assignments' }),
    ).toBeDisabled();
    expect(
      screen.getByText('Not sent yet — boards add members directly today'),
    ).toBeTruthy();
    expect(screen.getByText('Always on')).toBeTruthy();
    await toggle('In-app: Card assignments');
    expect(env.requests.filter((r) => r.init.method === 'PATCH')).toHaveLength(
      0,
    );
    await press('Cancel');
    expect(
      screen.getByRole('switch', {
        name: 'In-app: Card assignments',
        checked: true,
      }),
    ).toBeTruthy();
    await toggle('In-app: Card assignments');
    await press('Save changes');
    await screen.findByText('Notification preferences saved.');
    expect(
      JSON.parse(env.requests.find((r) => r.init.method === 'PATCH').init.body),
    ).toEqual({ inApp: { cardAssigned: false } });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  } finally {
    await env.dispose();
  }
});
