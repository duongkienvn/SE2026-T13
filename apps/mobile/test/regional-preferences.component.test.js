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
import { integration, ok, json } from './realtime/integration-support';
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

test('dirty touched fields survive Web changes and need explicit conflict review', async () => {
  const env = await setup();
  await fireEvent.press(screen.getByRole('radio', { name: 'DD/MM/YYYY' }));
  await act(() =>
    env.data.queryClient.setQueryData(queryKeys.datePreferences(env.identity), {
      theme: 'dark',
      timeZone: 'UTC',
      dateFormat: 'MM/DD/YYYY',
      weekStartsOn: 'monday',
    }),
  );
  expect(await screen.findByText(/Preferences changed elsewhere/)).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'DD/MM/YYYY' })).toBeSelected();
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Keep my edits after review' }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Preferences saved.')).toBeTruthy();
  expect(
    JSON.parse(env.requests.find((r) => r.init.method === 'PATCH').init.body),
  ).toEqual({ dateFormat: 'DD/MM/YYYY' });
});

test('time zone selection is searchable, explicit and saved zone stays exact', async () => {
  const env = await setup();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Choose time zone' }),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Search time zones'),
    'Asia/Ho_Chi_Minh',
  );
  await fireEvent.press(
    screen.getByRole('radio', { name: 'Asia/Ho_Chi_Minh' }),
  );
  expect(screen.queryByLabelText('Search time zones')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Preferences saved.')).toBeTruthy();
  expect(
    JSON.parse(env.requests.find((r) => r.init.method === 'PATCH').init.body),
  ).toEqual({ timeZone: 'Asia/Ho_Chi_Minh' });
});

test('server zone rejection focuses the zone editor and preserves the selected draft', async () => {
  const env = await setup();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Choose time zone' }),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Search time zones'),
    'America/New_York',
  );
  await fireEvent.press(
    screen.getByRole('radio', { name: 'America/New_York' }),
  );
  env.respond(() => Promise.resolve(json({}, 400)));
  await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
  expect(
    await screen.findByText('Choose a time zone supported by the server.'),
  ).toBeTruthy();
  expect(
    screen.getByRole('radio', { name: 'America/New_York' }),
  ).toBeSelected();
  expect(screen.queryByText('Preferences saved.')).toBeNull();
  expect(
    screen.getByLabelText('Search time zones').props.accessibilityHint,
  ).toBe('Choose a time zone supported by the server.');
});
