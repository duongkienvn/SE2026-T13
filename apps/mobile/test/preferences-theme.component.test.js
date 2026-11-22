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
let cleanup;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
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
