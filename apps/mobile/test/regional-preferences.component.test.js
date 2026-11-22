/* global test,expect,jest,afterEach */
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { PreferencesScreen } from '../src/features/preferences/PreferencesScreen';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { queryKeys } from '../src/infrastructure/query/keys';
import { integration, ok } from './realtime/integration-support';
const mockPrevent = jest.fn(),
  mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, canGoBack: () => true }),
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
let cleanup;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  onlineManager.setOnline(true);
  mockPrevent.mockClear();
  mockBack.mockClear();
});
async function setup() {
  const env = await integration();
  let prefs = {
    theme: 'system',
    timeZone: 'UTC',
    dateFormat: 'YYYY-MM-DD',
    weekStartsOn: 'monday',
  };
  env.respond(async (_u, init) => {
    if (init.method === 'PATCH') prefs = { ...prefs, ...JSON.parse(init.body) };
    return ok(prefs);
  });
  const view = await render(
    <SessionProvider manager={env.manager}>
      <DataProvider layer={env.data}>
        <PreferencesScreen />
      </DataProvider>
    </SessionProvider>,
  );
  cleanup = async () => {
    await view.unmount();
    env.dispose();
  };
  await act(() => focusManager.setFocused(true));
  await screen.findByText('Time zone');
  return env;
}
test('regional save submits only changed leaves and cancel adopts latest server fields', async () => {
  const env = await setup();
  await fireEvent.press(screen.getByRole('radio', { name: 'DD/MM/YYYY' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Preferences saved.')).toBeTruthy();
  expect(
    JSON.parse(env.requests.find((r) => r.init.method === 'PATCH').init.body),
  ).toEqual({ dateFormat: 'DD/MM/YYYY' });
  await fireEvent.press(screen.getByRole('radio', { name: 'Sunday' }));
  await act(() =>
    env.data.queryClient.setQueryData(queryKeys.datePreferences(env.identity), {
      theme: 'dark',
      timeZone: 'America/New_York',
      dateFormat: 'DD/MM/YYYY',
      weekStartsOn: 'monday',
    }),
  );
  expect(screen.getByRole('radio', { name: 'Sunday' })).toBeSelected();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('radio', { name: 'Monday' })).toBeSelected();
  expect(screen.getByText('America/New_York')).toBeTruthy();
});
test('dirty hardware Back offers Keep editing and Discard and conflict requires review', async () => {
  const env = await setup();
  await fireEvent.press(screen.getByRole('radio', { name: 'Sunday' }));
  let repeat = jest.fn();
  await act(() => mockPrevent.mock.calls.at(-1)[1]({ repeat }));
  await fireEvent.press(screen.getByRole('button', { name: 'Keep editing' }));
  expect(repeat).not.toHaveBeenCalled();
  expect(screen.getByRole('radio', { name: 'Sunday' })).toBeSelected();
  await act(() =>
    env.data.queryClient.setQueryData(queryKeys.datePreferences(env.identity), {
      theme: 'dark',
      timeZone: 'UTC',
      dateFormat: 'MM/DD/YYYY',
      weekStartsOn: 'monday',
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole('radio', { name: 'MM/DD/YYYY' })).toBeSelected(),
  );
  await act(() => mockPrevent.mock.calls.at(-1)[1]({ repeat }));
  await fireEvent.press(screen.getByRole('button', { name: 'Discard' }));
  expect(repeat).toHaveBeenCalledTimes(1);
});
