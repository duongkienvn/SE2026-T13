/* global jest, test, expect, afterEach */
import { URL } from 'node:url';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { PushScheduleScreen } from '../src/features/push/schedule/PushScheduleScreen';
import { PushContext } from '../src/features/push/context';
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
import { scheduleKey } from '../src/features/push/schedule/api';
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    canGoBack: () => true,
    replace: jest.fn(),
    push: jest.fn(),
  }),
  useIsFocused: () => true,
  usePreventRemove: () => () => {},
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
jest.mock('@react-native-community/datetimepicker', () => {
  const { Pressable, View, Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (props) => (
      <View>
        {['07:00', '06:45'].map((time) => (
          <Pressable
            key={time}
            accessibilityRole="button"
            accessibilityLabel={`${props.accessibilityLabel} ${time}`}
            onPress={() =>
              props.onValueChange({}, new Date(`2000-01-01T${time}:00Z`))
            }
          >
            <Text>{time}</Text>
          </Pressable>
        ))}
      </View>
    ),
    DateTimePickerAndroid: {
      open: (options) => options.onError(),
      dismiss: async () => {},
    },
  };
});
const defaults = () => ({
  enabled: false,
  startLocal: '22:00',
  endLocal: '07:00',
  timeZone: 'UTC',
});
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
async function setup(
  override,
  mode = 'light',
  push = { enabled: false, deliveryAvailable: true },
) {
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
      baseUrl: new URL('https://schedule.example.test/api'),
      clock,
      timers: clock,
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        const custom = override?.(init, server);
        if (custom) return custom;
        if (init.method === 'PATCH')
          server = { ...server, ...JSON.parse(init.body) };
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
  const state = { preferences: push, capability: 'needs-build' };
  const controller = { subscribe: () => () => {}, getSnapshot: () => state };
  const tree = (entry = 0) => (
    <SessionProvider manager={manager}>
      <DataProvider layer={data}>
        <ThemeContext.Provider value={mode}>
          <PushContext.Provider value={controller}>
            <PushScheduleScreen key={entry} />
          </PushContext.Provider>
        </ThemeContext.Provider>
      </DataProvider>
    </SessionProvider>
  );
  const view = await render(tree());
  await act(() => focusManager.setFocused(true));
  return {
    data,
    manager,
    requests,
    clock,
    remount: () => view.rerender(tree(1)),
    setServer: (value) => {
      server = value;
    },
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
const toggle = async (enabled) =>
  fireEvent(
    await screen.findByRole('switch', { name: 'Quiet hours' }),
    'valueChange',
    enabled,
  );
afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(true);
  jest.useRealTimers();
});
test('defaults, exact copy, OFF/Expo Go status, draft Cancel and authoritative sparse Save', async () => {
  const env = await setup();
  try {
    await screen.findByRole('switch', { name: 'Quiet hours', checked: false });
    expect(
      screen.getByText(
        'New push alerts are held until quiet hours end, if they have not expired. Notifications still appear in Inbox.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Push is disabled for this account/)).toBeTruthy();
    expect(
      screen.getByText(/Remote push is unavailable in Expo Go/),
    ).toBeTruthy();
    expect(screen.getByText('UTC')).toBeTruthy();
    await toggle(true);
    expect(env.requests.filter((r) => r.init.method === 'PATCH')).toHaveLength(
      0,
    );
    await press('Cancel');
    expect(
      screen.getByRole('switch', { name: 'Quiet hours', checked: false }),
    ).toBeTruthy();
    await toggle(true);
    await press('Save quiet hours');
    await screen.findByText('Quiet hours saved.');
    expect(env.requests.filter((r) => r.init.method === 'PATCH')).toHaveLength(
      1,
    );
    expect(
      JSON.parse(env.requests.find((r) => r.init.method === 'PATCH').init.body),
    ).toEqual({ enabled: true });
    expect(
      env.requests.every((r) => r.url.endsWith('/users/me/push-schedule')),
    ).toBe(true);
  } finally {
    await env.dispose();
  }
});
test('quarter-hour selection and equal-time validation; disabled schedule retains clocks', async () => {
  const env = await setup(undefined, 'dark');
  try {
    await press('Start time, 22:00');
    await press('Start time 07:00');
    await press('Close time selector');
    await toggle(true);
    expect(
      screen.getByText(
        'Start and end must differ when quiet hours are enabled.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Save quiet hours' }),
    ).toBeDisabled();
    await press('End time, 07:00');
    await press('End time 06:45');
    await press('Close time selector');
    await press('Save quiet hours');
    await screen.findByText('Quiet hours saved.');
    expect(env.server).toMatchObject({
      enabled: true,
      startLocal: '07:00',
      endLocal: '06:45',
    });
  } finally {
    await env.dispose();
  }
});
test('loading/error Retry and honest server-unavailable status', async () => {
  let finish;
  const env = await setup(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    'light',
    { enabled: true, deliveryAvailable: false },
  );
  try {
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.getByText('Loading quiet hours…')).toBeTruthy();
    await act(() => finish(wire({}, 500)));
    await screen.findByText('Couldn’t load quiet hours. Try again.');
    await press('Retry quiet hours');
    await act(() => finish(wire(defaults())));
    await screen.findByRole('switch', { name: 'Quiet hours' });
    expect(
      screen.getByText(/Push delivery unavailable on this server/),
    ).toBeTruthy();
  } finally {
    await env.dispose();
  }
});
test('background/foreground and timezone refresh preserve dirty draft', async () => {
  const env = await setup();
  try {
    await toggle(true);
    await act(() =>
      env.data.queryClient.setQueryData(scheduleKey(env.data.getIdentity()), {
        ...defaults(),
        timeZone: 'Asia/Tokyo',
      }),
    );
    await screen.findByText('Asia/Tokyo');
    expect(
      screen.getByRole('switch', { name: 'Quiet hours', checked: true }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Save quiet hours' }),
    ).toBeDisabled();
    await act(() => focusManager.setFocused(false));
    await act(() => focusManager.setFocused(true));
    await press('Review and keep my edits');
    await press('Save quiet hours');
    await screen.findByText('Quiet hours saved.');
    expect(
      JSON.parse(env.requests.find((r) => r.init.method === 'PATCH').init.body),
    ).toEqual({ enabled: true });
  } finally {
    await env.dispose();
  }
});
test('offline preserves draft and blocks Save; 429 prevents Retry/cooldown bypass', async () => {
  const env = await setup();
  try {
    await toggle(true);
    await act(() => onlineManager.setOnline(false));
    expect(
      screen.getByRole('button', { name: 'Save quiet hours' }),
    ).toBeDisabled();
    expect(screen.getByText(/You’re offline. Your draft is kept/)).toBeTruthy();
    expect(
      screen.getByRole('switch', { name: 'Quiet hours', checked: true }),
    ).toBeTruthy();
  } finally {
    await env.dispose();
  }
  const limited = await setup(() => wire({}, 429, '60'));
  try {
    await screen.findByText('Too many requests. Wait before trying again.');
    expect(
      screen.getByRole('button', { name: 'Retry quiet hours' }),
    ).toBeDisabled();
    const count = limited.requests.length;
    await act(() => onlineManager.setOnline(false));
    await act(() => onlineManager.setOnline(true));
    expect(limited.requests).toHaveLength(count);
  } finally {
    await limited.dispose();
  }
});
test('concurrent Save blocked and timeout never claims Saved or resets draft, including remount', async () => {
  let finish;
  const env = await setup((init) =>
    init.method === 'PATCH'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : null,
  );
  try {
    await toggle(true);
    await press('Save quiet hours');
    await press('Save quiet hours');
    expect(env.requests.filter((r) => r.init.method === 'PATCH')).toHaveLength(
      1,
    );
    await act(() => env.clock.advance(15001));
    await screen.findByText(/Save wasn’t confirmed/);
    expect(screen.queryByText('Quiet hours saved.')).toBeNull();
    expect(
      screen.getByRole('switch', { name: 'Quiet hours', checked: true }),
    ).toBeTruthy();
    await press('Check server schedule');
    expect(
      screen.getByRole('button', { name: 'Save quiet hours' }),
    ).toBeDisabled();
    await env.remount();
    await screen.findByText(/Save wasn’t confirmed/);
    expect(
      screen.getByRole('button', { name: 'Save quiet hours' }),
    ).toBeDisabled();
    await act(() => finish(wire({ ...defaults(), enabled: true })));
    expect(screen.queryByText('Quiet hours saved.')).toBeNull();
  } finally {
    await env.dispose();
  }
});
test('account switch during delayed Save shows no old draft or ACK in new user', async () => {
  let finish;
  const env = await setup((init) =>
    init.method === 'PATCH'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : null,
  );
  try {
    await toggle(true);
    await press('Save quiet hours');
    await act(async () => {
      await env.manager.logout();
      await env.manager.establishSession(loginResponse(USER_B));
    });
    await screen.findByRole('switch', { name: 'Quiet hours', checked: false });
    await act(() => finish(wire({ ...defaults(), enabled: true })));
    expect(
      screen.getByRole('switch', { name: 'Quiet hours', checked: false }),
    ).toBeTruthy();
    expect(screen.queryByText('Quiet hours saved.')).toBeNull();
  } finally {
    await env.dispose();
  }
});
