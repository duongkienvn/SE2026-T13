/* global test, expect, jest, afterEach */
import { render, screen, act, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { focusManager } from '@tanstack/react-query';
import { AccountThemeProvider } from '../src/features/preferences/AccountThemeProvider';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { useTheme, palettes } from '../src/ui';
import { integration, ok } from './realtime/integration-support';
import { USER_B, loginResponse } from './auth/support';
import { queryKeys } from '../src/infrastructure/query/keys';
import { preferencesCommands } from '../src/features/preferences/commands';
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
let mockScheme = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));
const mockStatusBar = jest.fn(() => null);
jest.mock('expo-status-bar', () => ({
  StatusBar: (props) => mockStatusBar(props),
}));
let cleanup;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  mockScheme = 'light';
  mockStatusBar.mockClear();
});
function Probe() {
  const c = useTheme();
  return <Text>{c.background}</Text>;
}
test('root account theme uses confirmed and preview palettes, resets before B loads', async () => {
  const env = await integration();
  let server = {
    theme: 'dark',
    timeZone: 'UTC',
    dateFormat: 'YYYY-MM-DD',
    weekStartsOn: 'monday',
  };
  env.respond(async () => ok(server));
  const view = await render(
    <SessionProvider manager={env.manager}>
      <DataProvider layer={env.data}>
        <AccountThemeProvider>
          <Probe />
        </AccountThemeProvider>
      </DataProvider>
    </SessionProvider>,
  );
  cleanup = async () => {
    await view.unmount();
    env.dispose();
  };
  await act(() => focusManager.setFocused(true));
  expect(await screen.findByText(palettes.dark.background)).toBeTruthy();
  let release;
  env.respond(() => new Promise((r) => (release = r)));
  let pending;
  await act(() => {
    pending = preferencesCommands(env.data, env.identity).chooseTheme('light');
  });
  expect(await screen.findByText(palettes.light.background)).toBeTruthy();
  await act(async () => {
    release(ok({ ...server, theme: 'light' }));
    await pending;
  });
  const scheduleKey = [...queryKeys.scope(env.identity), 'me', 'push-schedule'];
  env.data.queryClient.setQueryData(scheduleKey, { timeZone: 'UTC' });
  await act(() =>
    env.data.queryClient.setQueryData(queryKeys.datePreferences(env.identity), {
      ...server,
      timeZone: 'Asia/Ho_Chi_Minh',
    }),
  );
  await waitFor(() =>
    expect(env.data.queryClient.getQueryState(scheduleKey).isInvalidated).toBe(
      true,
    ),
  );
  server = { ...server, theme: 'light' };
  env.respond(() => new Promise(() => {}));
  await act(() => env.manager.establishSession(loginResponse(USER_B)));
  await waitFor(() =>
    expect(screen.queryByText(palettes.dark.background)).toBeNull(),
  );
});

test('system tracks native scheme and status bar; fixed theme ignores OS; new identity falls back immediately', async () => {
  const env = await integration();
  const prefs = {
    theme: 'system',
    timeZone: 'UTC',
    dateFormat: 'YYYY-MM-DD',
    weekStartsOn: 'monday',
  };
  env.respond(async () => ok(prefs));
  const tree = () => (
    <SessionProvider manager={env.manager}>
      <DataProvider layer={env.data}>
        <AccountThemeProvider>
          <Probe />
        </AccountThemeProvider>
      </DataProvider>
    </SessionProvider>
  );
  const view = await render(tree());
  cleanup = async () => {
    await view.unmount();
    env.dispose();
  };
  await act(() => focusManager.setFocused(true));
  await screen.findByText(palettes.light.background);
  mockScheme = 'dark';
  await view.rerender(tree());
  expect(await screen.findByText(palettes.dark.background)).toBeTruthy();
  expect(mockStatusBar.mock.calls.at(-1)[0].style).toBe('light');
  await act(() =>
    env.data.queryClient.setQueryData(queryKeys.datePreferences(env.identity), {
      ...prefs,
      theme: 'light',
    }),
  );
  await screen.findByText(palettes.light.background);
  expect(mockStatusBar.mock.calls.at(-1)[0].style).toBe('dark');
  mockScheme = null;
  await view.rerender(tree());
  expect(screen.getByText(palettes.light.background)).toBeTruthy();
  await act(() =>
    env.data.queryClient.setQueryData(queryKeys.datePreferences(env.identity), {
      ...prefs,
      theme: 'dark',
    }),
  );
  await screen.findByText(palettes.dark.background);
  env.respond(() => new Promise(() => {}));
  await act(() => env.manager.establishSession(loginResponse(USER_B)));
  expect(await screen.findByText(palettes.light.background)).toBeTruthy();
  expect(screen.queryByText(palettes.dark.background)).toBeNull();
});

test('rapid app resume revalidates a Web change even inside the preferences freshness window', async () => {
  const env = await integration();
  let prefs = {
    theme: 'light',
    timeZone: 'UTC',
    dateFormat: 'YYYY-MM-DD',
    weekStartsOn: 'monday',
  };
  env.respond(async () => ok(prefs));
  const view = await render(
    <SessionProvider manager={env.manager}>
      <DataProvider layer={env.data}>
        <AccountThemeProvider>
          <Probe />
        </AccountThemeProvider>
      </DataProvider>
    </SessionProvider>,
  );
  cleanup = async () => {
    await view.unmount();
    env.dispose();
  };
  await act(() => focusManager.setFocused(true));
  await screen.findByText(palettes.light.background);
  // Wait for the initial resource (the neutral OS palette is also light).
  await waitFor(() =>
    expect(
      env.data.queryClient.getQueryData(queryKeys.datePreferences(env.identity))
        ?.theme,
    ).toBe('light'),
  );
  await act(() => focusManager.setFocused(false));
  prefs = { ...prefs, theme: 'dark', timeZone: 'America/New_York' };
  await act(() => focusManager.setFocused(true));
  expect(await screen.findByText(palettes.dark.background)).toBeTruthy();
});

test('resume through a pending PATCH defers one shared read until its ACK', async () => {
  const env = await integration();
  let prefs = {
      theme: 'light',
      timeZone: 'UTC',
      dateFormat: 'YYYY-MM-DD',
      weekStartsOn: 'monday',
    },
    release;
  env.respond((_u, init) =>
    init.method === 'PATCH'
      ? new Promise((r) => (release = r))
      : Promise.resolve(ok(prefs)),
  );
  const view = await render(
    <SessionProvider manager={env.manager}>
      <DataProvider layer={env.data}>
        <AccountThemeProvider>
          <Probe />
        </AccountThemeProvider>
      </DataProvider>
    </SessionProvider>,
  );
  cleanup = async () => {
    await view.unmount();
    env.dispose();
  };
  await act(() => focusManager.setFocused(true));
  await waitFor(() =>
    expect(
      env.data.queryClient.getQueryData(queryKeys.datePreferences(env.identity))
        ?.theme,
    ).toBe('light'),
  );
  const initialReads = env.requests.filter(
    (r) => r.init.method === 'GET',
  ).length;
  let pending;
  await act(() => {
    pending = preferencesCommands(env.data, env.identity).chooseTheme('dark');
  });
  await act(() => focusManager.setFocused(false));
  await act(() => focusManager.setFocused(true));
  expect(env.requests.filter((r) => r.init.method === 'GET').length).toBe(
    initialReads,
  );
  prefs = { ...prefs, theme: 'dark', timeZone: 'America/New_York' };
  await act(async () => {
    release(ok({ ...prefs, timeZone: 'UTC' }));
    await pending;
  });
  await waitFor(() =>
    expect(
      env.data.queryClient.getQueryData(queryKeys.datePreferences(env.identity))
        ?.timeZone,
    ).toBe('America/New_York'),
  );
  expect(env.requests.filter((r) => r.init.method === 'GET').length).toBe(
    initialReads + 1,
  );
});
