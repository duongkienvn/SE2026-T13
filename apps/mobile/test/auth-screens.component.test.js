/* global jest, test, expect, afterEach */
import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react-native';
import { AuthProvider } from '../src/features/auth/runtime';
import { createAuthFlow } from '../src/features/auth/flow';
import { SignInScreen } from '../src/features/auth/SignInScreen';
import { SignUpScreen } from '../src/features/auth/SignUpScreen';
import { VerifyEmailScreen } from '../src/features/auth/VerifyEmailScreen';
import { ApiError } from '../src/infrastructure/api/errors';
import {
  ForgotPasswordScreen,
  ResetPasswordScreen,
} from '../src/features/auth/RecoveryScreens';

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (callback) =>
    jest.requireActual('react').useEffect(callback, [callback]),
}));
afterEach(async () => {
  await cleanup();
  jest.clearAllMocks();
});
function setup(overrides = {}) {
  const flow = createAuthFlow();
  const snapshot = {
    status: 'unauthenticated',
    generation: 1,
    reason: 'no-credential',
  };
  const manager = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    addLifecycleListener: () => () => {},
    isCurrent: (gen) => gen === 1,
    establishSession: jest.fn(async () => ({ ok: true })),
  };
  const api = {
    login: jest.fn(),
    register: jest.fn(async () => ({})),
    verify: jest.fn(async () => {}),
    resend: jest.fn(async () => null),
    forgot: jest.fn(async () => null),
    reset: jest.fn(async () => {}),
    ...overrides,
  };
  return {
    api,
    manager,
    flow,
    render: (Component) =>
      render(
        <AuthProvider api={api} manager={manager} flow={flow}>
          <Component />
        </AuthProvider>,
      ),
  };
}
async function fillRegistration() {
  for (const [label, value] of [
    ['Full name', 'Test User'],
    ['Email address', 'user@example.test'],
    ['Password', 'Password1!'],
    ['Confirm password', 'Password1!'],
  ])
    await fireEvent.changeText(screen.getByLabelText(label), value);
}
test('register 201 enters check email without establishing a session', async () => {
  const ctx = setup();
  await ctx.render(SignUpScreen);
  await fillRegistration();
  await fireEvent.press(screen.getByRole('button', { name: 'Sign up' }));
  expect(ctx.api.register).toHaveBeenCalledWith(
    'Test User',
    'user@example.test',
    'Password1!',
    expect.any(AbortSignal),
  );
  expect(ctx.manager.establishSession).not.toHaveBeenCalled();
  expect(mockRouter.replace).toHaveBeenCalledWith('/verify-email');
  expect(ctx.flow.getSnapshot().email).toBe('user@example.test');
  expect(screen.getByLabelText('Password').props.value).toBe('');
});
test('post-commit mail failure enters a usable resend path and never retries registration', async () => {
  const ctx = setup({
    register: jest.fn(async () => {
      throw new ApiError('http', {
        status: 503,
        code: 'MAIL_DELIVERY_UNAVAILABLE',
      });
    }),
  });
  await ctx.render(SignUpScreen);
  await fillRegistration();
  await fireEvent.press(screen.getByRole('button', { name: 'Sign up' }));
  expect(ctx.flow.getSnapshot().mailFailure).toBe(true);
  expect(mockRouter.replace).toHaveBeenCalledWith('/verify-email');
  expect(ctx.api.register).toHaveBeenCalledTimes(1);
});
test('unverified login clears the password, retains email and offers real verification', async () => {
  const ctx = setup({
    login: jest.fn(async () => {
      throw new ApiError('http', { status: 403, code: 'EMAIL_NOT_VERIFIED' });
    }),
  });
  await ctx.render(SignInScreen);
  await fireEvent.changeText(
    screen.getByLabelText('Email address'),
    'user@example.test',
  );
  await fireEvent.changeText(screen.getByLabelText('Password'), 'password');
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(screen.getByLabelText('Password').props.value).toBe('');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Verify email or resend link' }),
  );
  expect(mockRouter.push).toHaveBeenCalledWith('/verify-email');
  expect(ctx.flow.getSnapshot().email).toBe('user@example.test');
});
test('duplicate taps submit once; leaving aborts and fences an ignored late login response', async () => {
  let resolve;
  const ctx = setup({
    login: jest.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    ),
  });
  const view = await ctx.render(SignInScreen);
  await fireEvent.changeText(
    screen.getByLabelText('Email address'),
    'user@example.test',
  );
  await fireEvent.changeText(screen.getByLabelText('Password'), 'password');
  const button = screen.getByRole('button', { name: 'Sign in' });
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(ctx.api.login).toHaveBeenCalledTimes(1);
  const signal = ctx.api.login.mock.calls[0][2];
  await view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ accessToken: 'ignored' }));
  expect(ctx.manager.establishSession).not.toHaveBeenCalled();
});
test('verification only sends an explicit trusted proof and never logs in', async () => {
  const ctx = setup();
  ctx.flow.intake('https://kanvexa.tech/verify-email?token=' + 'a'.repeat(43));
  await ctx.render(VerifyEmailScreen);
  await fireEvent.press(screen.getByRole('button', { name: 'Verify email' }));
  expect(ctx.api.verify).toHaveBeenCalledTimes(1);
  expect(ctx.flow.getSnapshot().hasProof).toBe(false);
  expect(screen.getByText('Email verified')).toBeTruthy();
  expect(ctx.manager.establishSession).not.toHaveBeenCalled();
});
test('check email explains browser fallback and preserves conditional resend acknowledgement', async () => {
  const ctx = setup();
  ctx.flow.setEmail('user@example.test');
  await ctx.render(VerifyEmailScreen);
  expect(screen.queryByRole('button', { name: 'Verify email' })).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Resend verification email' }),
  );
  expect(screen.getByText(/If verification is needed/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: /Resend available in/ }).props
      .accessibilityState.disabled,
  ).toBe(true);
});

test('forgot keeps a deliberate pending state and gives generic cooldown feedback', async () => {
  let finish;
  const ctx = setup({
    forgot: jest.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  });
  await ctx.render(ForgotPasswordScreen);
  await fireEvent.changeText(
    screen.getByLabelText('Email address'),
    'unknown@example.test',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Send reset link' }),
  );
  expect(screen.getByText(/Requesting a recovery link/)).toBeTruthy();
  await act(async () => finish(null));
  expect(screen.getByText(/If this email is eligible/)).toBeTruthy();
  expect(
    screen.getByRole('button', { name: /Request again in/ }).props
      .accessibilityState.disabled,
  ).toBe(true);
});
test('reset without proof is disabled; valid reset consumes proof and requires fresh sign in', async () => {
  const ctx = setup();
  const view = await ctx.render(ResetPasswordScreen);
  expect(
    screen.getByRole('button', { name: 'Reset password' }).props
      .accessibilityState.disabled,
  ).toBe(true);
  await view.unmount();
  const next = setup();
  next.flow.intake(
    'https://kanvexa.tech/reset-password?token=' + 'b'.repeat(43),
  );
  await next.render(ResetPasswordScreen);
  await fireEvent.changeText(
    screen.getByLabelText('New password'),
    'NewPassword1!',
  );
  await fireEvent.changeText(
    screen.getByLabelText('Confirm password'),
    'NewPassword1!',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Reset password' }));
  expect(next.api.reset).toHaveBeenCalledWith(
    'b'.repeat(43),
    'NewPassword1!',
    expect.any(AbortSignal),
  );
  expect(next.flow.getSnapshot().hasProof).toBe(false);
  expect(next.flow.getSnapshot().notice).toMatch(/Password reset/);
  expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in');
  expect(next.manager.establishSession).not.toHaveBeenCalled();
});
