/* global test,expect,jest,afterEach */
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppearanceScreen } from '../src/features/preferences/AppearanceScreen';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { integration, ok, json } from './realtime/integration-support';
jest.mock('expo-router', () => ({
  useRouter: () => ({ back() {}, canGoBack: () => true }),
  useIsFocused: () => true,
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
});
test('accessible theme choices preview while pending and report Saved only after 200', async () => {
  const env = await integration();
  const prefs = {
    theme: 'system',
    timeZone: 'UTC',
    dateFormat: 'YYYY-MM-DD',
    weekStartsOn: 'monday',
  };
  let release;
  env.respond((_u, init) =>
    init.method === 'PATCH'
      ? new Promise((r) => (release = r))
      : Promise.resolve(ok(prefs)),
  );
  const view = await render(
    <SessionProvider manager={env.manager}>
      <DataProvider layer={env.data}>
        <AppearanceScreen />
      </DataProvider>
    </SessionProvider>,
  );
  cleanup = async () => {
    await view.unmount();
    env.dispose();
  };
  await act(() => focusManager.setFocused(true));
  await waitFor(() =>
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeEnabled(),
  );
  await fireEvent.press(screen.getByRole('radio', { name: 'Dark' }));
  expect(screen.getByText('Saving…')).toBeTruthy();
  expect(screen.queryByText('Saved')).toBeNull();
  expect(screen.getByRole('radio', { name: 'Dark' })).toBeSelected();
  await act(() => release(ok({ ...prefs, theme: 'dark' })));
  expect(await screen.findByText('Saved')).toBeTruthy();
  env.respond(() => Promise.resolve(json({}, 400)));
  await fireEvent.press(screen.getByRole('radio', { name: 'Light' }));
  expect(await screen.findByText(/Couldn’t save/)).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Dark' })).toBeSelected();
  await act(() => onlineManager.setOnline(false));
  expect(screen.getByRole('radio', { name: 'Light' })).toBeDisabled();
});
