/* global jest, test, expect, afterEach */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { ChangeEmailScreen } from '../src/features/profile/ChangeEmailScreen';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { integration, json, ok } from './realtime/integration-support';
import {
  EMAIL_CHANGE_ACCEPTANCE,
  EMAIL_CHANGE_HANDOFF,
} from '../src/features/profile/email-change';
let mockGoogle = null;
jest.mock('../src/features/auth/runtime', () => ({
  ...jest.requireActual('../src/features/auth/runtime'),
  useAuth: () => ({ google: mockGoogle }),
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (fn) => jest.requireActual('react').useEffect(fn, [fn]),
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: () => true,
    replace: jest.fn(),
  }),
  useIsFocused: () => true,
  usePreventRemove: () => () => {},
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
let cleanup;
async function setup(
  providers = { hasPassword: true, googleLinked: false },
  override,
) {
  const env = await integration();
  const requests = [];
  env.respond(async (url, init) => {
    requests.push({ url, init });
    const custom = override?.(url, init);
    if (custom) return custom;
    if (url.endsWith('/linked-providers')) return ok(providers);
    if (url.endsWith('/pending')) return ok(null);
    if (url.endsWith('/request'))
      return json(
        { success: true, statusCode: 202, message: 'Accepted', data: null },
        202,
      );
    return ok(null);
  });
  const view = await render(
    <SessionProvider manager={env.manager}>
      <DataProvider layer={env.data}>
        <ChangeEmailScreen />
      </DataProvider>
    </SessionProvider>,
  );
  await act(() => focusManager.setFocused(true));
  cleanup = async () => {
    await view.unmount();
    env.dispose();
  };
  return { ...env, requests };
}
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  mockGoogle = null;
  onlineManager.setOnline(true);
});
test('202 shows generic acceptance and Web handoff, clears password and applies cooldown', async () => {
  const env = await setup();
  await screen.findByLabelText('Current password');
  await fireEvent.changeText(
    screen.getByLabelText('New email'),
    ' New@Example.com ',
  );
  await fireEvent.changeText(
    screen.getByLabelText('Current password'),
    'proof',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Request email change' }),
  );
  expect(await screen.findByText(EMAIL_CHANGE_ACCEPTANCE)).toBeTruthy();
  expect(screen.getByText(EMAIL_CHANGE_HANDOFF)).toBeTruthy();
  expect(screen.getByLabelText('Current password').props.value).toBe('');
  expect(
    screen.getByRole('button', { name: 'Request email change' }),
  ).toBeDisabled();
  expect(
    env.requests.filter(({ url }) => url.endsWith('/request')),
  ).toHaveLength(1);
  expect(env.data.queryClient.getMutationCache().getAll()).toHaveLength(0);
});
test('Google-only account with unconfigured build explains available alternative and hides unusable proofs', async () => {
  await setup({ hasPassword: false, googleLinked: true });
  expect(
    await screen.findByText(
      /Google verification needs a configured native build/,
    ),
  ).toBeTruthy();
  expect(screen.queryByLabelText('Current password')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Verify with linked Google' }),
  ).toBeNull();
});
test('only masked server pending data is displayed; password rejection never echoes server text', async () => {
  const now = Date.now();
  await setup(undefined, (url) =>
    url.endsWith('/pending')
      ? ok({
          maskedNewEmail: 'n***@e***',
          issuedAt: new Date(now - 120000).toISOString(),
          expiresAt: new Date(now + 120000).toISOString(),
        })
      : url.endsWith('/request')
        ? json(
            {
              success: false,
              statusCode: 403,
              code: 'INVALID_CREDENTIALS',
              message: 'SECRET server text',
            },
            403,
          )
        : null,
  );
  expect(await screen.findByText(/n\*\*\*@e\*\*\*/)).toBeTruthy();
  await fireEvent.changeText(
    screen.getByLabelText('New email'),
    'new@example.com',
  );
  await fireEvent.changeText(screen.getByLabelText('Current password'), 'bad');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Request email change' }),
  );
  expect(
    await screen.findByText('Your current password is incorrect.'),
  ).toBeTruthy();
  expect(screen.queryByText(/SECRET/)).toBeNull();
  expect(screen.getByLabelText('Current password').props.value).toBe('');
});
