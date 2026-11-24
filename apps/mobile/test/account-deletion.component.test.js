/* global jest, test, expect, afterEach, Response */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { DeleteAccountScreen } from '../src/features/account-deletion/DeleteAccountScreen';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { integration, ok, json } from './realtime/integration-support';
import { USER_A, USER_B, loginResponse } from './auth/support';
const mockRouter = {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  },
  mockPrevent = jest.fn();
let mockGoogle = null;
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useIsFocused: () => true,
  useFocusEffect: (fn) => jest.requireActual('react').useEffect(fn, [fn]),
  usePreventRemove: (blocked, fn) => {
    mockPrevent(blocked, fn);
    return () => {};
  },
}));
jest.mock('../src/features/auth/runtime', () => ({
  ...jest.requireActual('../src/features/auth/runtime'),
  useAuth: () => ({ google: mockGoogle }),
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
let cleanup;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  mockGoogle = null;
  jest.clearAllMocks();
  onlineManager.setOnline(true);
});
async function setup(
  providers = { hasPassword: true, googleLinked: false },
  response = () => new Response(null, { status: 204 }),
) {
  const env = await integration();
  env.respond((_url, init) =>
    Promise.resolve(init.method === 'DELETE' ? response() : ok(providers)),
  );
  const view = await render(
    <SessionProvider manager={env.manager}>
      <DataProvider layer={env.data}>
        <DeleteAccountScreen />
      </DataProvider>
    </SessionProvider>,
  );
  await act(() => focusManager.setFocused(true));
  cleanup = async () => {
    await view.unmount();
    env.dispose();
  };
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Refresh verification methods' }),
    ).toBeEnabled(),
  );
  return env;
}
const press = (name) => fireEvent.press(screen.getByRole('button', { name }));
async function fill(confirmation = 'DELETE') {
  await fireEvent.changeText(
    screen.getByLabelText('Type DELETE to confirm'),
    confirmation,
  );
  await fireEvent.changeText(
    screen.getByLabelText('Current password'),
    'private-proof',
  );
}
test('exact confirmation, deliberate final confirmation, and only 204 removes protected UI', async () => {
  const env = await setup();
  expect(
    screen.getByText(/Shared boards, cards and comments remain/),
  ).toBeTruthy();
  await fill(' DELETE');
  expect(
    screen.getByRole('button', { name: 'Review deletion' }),
  ).toBeDisabled();
  await fill();
  await press('Review deletion');
  expect(env.requests.filter((r) => r.init.method === 'DELETE')).toHaveLength(
    0,
  );
  await press('Keep my account');
  expect(screen.getByLabelText('Current password').props.value).toBe(
    'private-proof',
  );
  await press('Review deletion');
  await press('Delete permanently');
  await waitFor(() =>
    expect(env.manager.getSnapshot().status).toBe('unauthenticated'),
  );
  expect(env.manager.getSnapshot().reason).toBe('account-deleted');
  expect(screen.queryByLabelText('Current password')).toBeNull();
  expect(env.requests.filter((r) => r.init.method === 'DELETE')).toHaveLength(
    1,
  );
});
test('dirty Back protects the draft and account switching clears all deletion inputs', async () => {
  const env = await setup();
  await fill();
  const callback = mockPrevent.mock.calls
      .filter(([blocked]) => blocked)
      .at(-1)[1],
    repeat = jest.fn();
  await act(() => callback({ repeat }));
  await press('Keep editing');
  expect(screen.getByLabelText('Current password').props.value).toBe(
    'private-proof',
  );
  await act(() => callback({ repeat }));
  await press('Discard');
  expect(repeat).toHaveBeenCalled();
  expect(screen.getByLabelText('Current password').props.value).toBe('');
  await fill();
  await act(() => env.manager.establishSession(loginResponse(USER_B)));
  await waitFor(() =>
    expect(screen.getByLabelText('Type DELETE to confirm').props.value).toBe(
      '',
    ),
  );
  expect(screen.getByLabelText('Current password').props.value).toBe('');
  expect(env.data.getIdentity().userId).toBe(USER_B);
  expect(USER_A).not.toBe(USER_B);
});
test('all three blockers show totals and excerpts; refresh never retries deletion', async () => {
  const blockers = [
    'PERSONAL_WORKSPACE_HAS_BOARDS',
    'BOARD_REQUIRES_ANOTHER_OWNER',
    'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN',
  ].map((type, n) => ({
    type,
    totalCount: 25,
    resources: [{ id: USER_A, name: `Resource ${n}` }],
  }));
  const env = await setup(undefined, () =>
    json(
      {
        success: false,
        statusCode: 409,
        code: 'ACCOUNT_DELETION_BLOCKED',
        message: 'SECRET',
        blockers,
      },
      409,
    ),
  );
  await fill();
  await press('Review deletion');
  await press('Delete permanently');
  await screen.findByText('Boards needing another owner');
  expect(screen.getAllByText('Showing 1 of 25 resources.')).toHaveLength(3);
  expect(screen.queryByText('SECRET')).toBeNull();
  expect(screen.getByLabelText('Current password').props.value).toBe('');
  await press('Refresh verification methods');
  expect(env.requests.filter((r) => r.init.method === 'DELETE')).toHaveLength(
    1,
  );
});
test('Google-only account without a native SDK is never offered an unusable destructive control', async () => {
  const env = await setup({ hasPassword: false, googleLinked: true });
  expect(screen.getByText(/configured native build/)).toBeTruthy();
  expect(screen.queryByLabelText('Current password')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Review deletion' }),
  ).toBeDisabled();
  expect(env.requests.filter((r) => r.init.method === 'DELETE')).toHaveLength(
    0,
  );
});
