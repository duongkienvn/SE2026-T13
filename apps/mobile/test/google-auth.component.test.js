/* global jest, test, expect, afterEach, AbortSignal, describe, Buffer */
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
import { createGoogleProvider } from '../src/features/auth/google-native';
import { ApiError } from '../src/infrastructure/api/errors';

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

const WEB = '123456789012-webclient.apps.googleusercontent.com';
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const TOKEN = [
  b64({ alg: 'RS256' }),
  b64({ aud: WEB, iss: 'https://accounts.google.com', sub: '42' }),
  'c2ln',
].join('.');
const LOGIN = {
  accessToken: 'kanvexa.jwt.value',
  tokenType: 'Bearer',
  expiresIn: 3600,
  user: { id: 'u' },
};
const GOOGLE = 'Continue with Google';

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function setup({ api: apiOverrides = {}, google, generation } = {}) {
  const flow = createAuthFlow();
  const state = { generation: generation ?? 1 };
  const snapshot = {
    status: 'unauthenticated',
    generation: 1,
    reason: 'no-credential',
  };
  const manager = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    addLifecycleListener: () => () => {},
    isCurrent: (gen) => gen === state.generation,
    establishSession: jest.fn(async () => ({ ok: true })),
  };
  const api = {
    login: jest.fn(async () => LOGIN),
    register: jest.fn(async () => ({})),
    google: jest.fn(async () => LOGIN),
    ...apiOverrides,
  };
  const provider =
    google === null
      ? null
      : {
          webClientId: WEB,
          requestIdToken: jest.fn(async () => ({
            kind: 'token',
            idToken: TOKEN,
          })),
          reset: jest.fn(async () => {}),
          ...google,
        };
  return {
    api,
    manager,
    provider,
    state,
    render: (Component) =>
      render(
        <AuthProvider api={api} manager={manager} flow={flow} google={provider}>
          <Component />
        </AuthProvider>,
      ),
  };
}
const press = (name) => fireEvent.press(screen.getByRole('button', { name }));

test('without a configured native provider there is no Google action or divider', async () => {
  const ctx = setup({ google: null });
  await ctx.render(SignInScreen);
  expect(screen.queryByRole('button', { name: GOOGLE })).toBeNull();
  expect(screen.queryByText('or continue with')).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
});

test('Google on sign in exchanges the ID token and hands the login to the session manager', async () => {
  const ctx = setup();
  await ctx.render(SignInScreen);
  expect(screen.getByText('or continue with')).toBeTruthy();
  await press(GOOGLE);
  expect(ctx.provider.requestIdToken).toHaveBeenCalledTimes(1);
  expect(ctx.api.google).toHaveBeenCalledWith(TOKEN, expect.any(AbortSignal));
  expect(ctx.manager.establishSession).toHaveBeenCalledWith(
    LOGIN,
    expect.any(AbortSignal),
  );
  expect(ctx.api.login).not.toHaveBeenCalled();
  expect(ctx.provider.reset).toHaveBeenCalled();
  expect(mockRouter.push).not.toHaveBeenCalled();
});

test('Google on sign up never registers a local account', async () => {
  const ctx = setup();
  await ctx.render(SignUpScreen);
  await press(GOOGLE);
  expect(ctx.api.google).toHaveBeenCalledTimes(1);
  expect(ctx.manager.establishSession).toHaveBeenCalledTimes(1);
  expect(ctx.api.register).not.toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('closing the Google prompt is not an error and leaves the session unchanged', async () => {
  const ctx = setup({
    google: { requestIdToken: jest.fn(async () => ({ kind: 'cancelled' })) },
  });
  await ctx.render(SignInScreen);
  await press(GOOGLE);
  expect(ctx.api.google).not.toHaveBeenCalled();
  expect(ctx.manager.establishSession).not.toHaveBeenCalled();
  expect(screen.queryByText(/couldn’t|could not|unavailable/i)).toBeNull();
  expect(
    screen.getByRole('button', { name: GOOGLE }).props.accessibilityState
      .disabled,
  ).toBe(false);
});

test.each([
  [
    { kind: 'play-services' },
    'Google Play services is required for Google sign-in. Update it, or use email and password.',
  ],
  [
    { kind: 'failed' },
    'Google sign-in couldn’t be completed. Try again or use email and password.',
  ],
  [
    {
      kind: 'token',
      idToken: [
        b64({}),
        b64({ aud: 'other', iss: 'accounts.google.com' }),
        'c2ln',
      ].join('.'),
    },
    'Google sign-in isn’t set up correctly for this app. Use email and password.',
  ],
])(
  'provider result %j shows safe copy without calling the backend',
  async (result, copy) => {
    const ctx = setup({
      google: { requestIdToken: jest.fn(async () => result) },
    });
    await ctx.render(SignInScreen);
    await press(GOOGLE);
    expect(screen.getByText(copy)).toBeTruthy();
    expect(ctx.api.google).not.toHaveBeenCalled();
  },
);

describe('backend failures are explained without auto-linking or echoing server text', () => {
  test.each([
    [
      401,
      'INVALID_GOOGLE_CREDENTIAL',
      'Google sign-in could not be verified. Please try again.',
    ],
    [
      409,
      'ACCOUNT_LINK_REQUIRED',
      'An account already uses this email. Sign in with your password first; you can connect Google later in your account settings.',
    ],
    [
      409,
      'GOOGLE_ACCOUNT_CONFLICT',
      'This Google account can’t be used here. Sign in with your password.',
    ],
    [
      503,
      'GOOGLE_AUTH_UNAVAILABLE',
      'Google sign-in is unavailable right now. Use email and password or try again later.',
    ],
    [
      500,
      'INTERNAL_ERROR',
      'The service is unavailable. Please try again later.',
    ],
  ])('%i %s', async (status, code, copy) => {
    const ctx = setup({
      api: {
        google: jest.fn(async () => {
          throw new ApiError('http', { status, code, message: 'RAW SERVER' });
        }),
      },
    });
    await ctx.render(SignInScreen);
    await press(GOOGLE);
    expect(screen.getByText(copy)).toBeTruthy();
    expect(screen.queryByText(/RAW SERVER/)).toBeNull();
    expect(ctx.manager.establishSession).not.toHaveBeenCalled();
  });

  test('offline and timeout', async () => {
    for (const [kind, copy] of [
      [
        'offline',
        'Could not connect. Check your internet connection and try again.',
      ],
      ['timeout', 'The request timed out. Try again.'],
    ]) {
      const ctx = setup({
        api: {
          google: jest.fn(async () => {
            throw new ApiError(kind);
          }),
        },
      });
      const view = await ctx.render(SignInScreen);
      await press(GOOGLE);
      expect(screen.getByText(copy)).toBeTruthy();
      await view.unmount();
    }
  });
});

test('unverified Google email offers the existing verification path', async () => {
  const ctx = setup({
    api: {
      google: jest.fn(async () => {
        throw new ApiError('http', { status: 403, code: 'EMAIL_NOT_VERIFIED' });
      }),
    },
  });
  await ctx.render(SignInScreen);
  await press(GOOGLE);
  expect(
    screen.getByText(
      'Verify your email before signing in. Check your inbox for the link.',
    ),
  ).toBeTruthy();
  await press('Verify email or resend link');
  expect(mockRouter.push).toHaveBeenCalledWith('/verify-email');
});

test('429 locks both sign-in actions until the cooldown ends', async () => {
  const ctx = setup({
    api: {
      google: jest.fn(async () => {
        throw new ApiError('http', {
          status: 429,
          code: 'TOO_MANY_REQUESTS',
          retryAfterMs: 90_000,
        });
      }),
    },
  });
  await ctx.render(SignInScreen);
  await press(GOOGLE);
  expect(
    screen.getByText('Too many attempts. Please wait before trying again.'),
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: GOOGLE }).props.accessibilityState
      .disabled,
  ).toBe(true);
  expect(
    screen.getByRole('button', { name: /Try again in \d+s/ }),
  ).toBeTruthy();
});

test('session verification failure after a good exchange is reported, not swallowed', async () => {
  const ctx = setup();
  ctx.manager.establishSession.mockResolvedValueOnce({
    ok: false,
    reason: 'unavailable',
  });
  await ctx.render(SignInScreen);
  await press(GOOGLE);
  expect(screen.getByText('Connect to verify your session.')).toBeTruthy();
});

test('double taps open one prompt and lock email sign-in while Google runs', async () => {
  const pending = deferred();
  const ctx = setup({
    google: { requestIdToken: jest.fn(() => pending.promise) },
  });
  await ctx.render(SignInScreen);
  await press(GOOGLE);
  await press(GOOGLE);
  expect(ctx.provider.requestIdToken).toHaveBeenCalledTimes(1);
  const signIn = screen.getByRole('button', { name: 'Sign in' });
  expect(signIn.props.accessibilityState.disabled).toBe(true);
  expect(
    screen.getByRole('button', { name: GOOGLE }).props.accessibilityState.busy,
  ).toBe(true);
  await act(async () => pending.resolve({ kind: 'cancelled' }));
  expect(
    screen.getByRole('button', { name: 'Sign in' }).props.accessibilityState
      .disabled,
  ).toBe(false);
});

test('leaving the screen discards a late Google token unsent', async () => {
  const pending = deferred();
  const ctx = setup({
    google: { requestIdToken: jest.fn(() => pending.promise) },
  });
  const view = await ctx.render(SignInScreen);
  await press(GOOGLE);
  await view.unmount();
  await act(async () => pending.resolve({ kind: 'token', idToken: TOKEN }));
  expect(ctx.api.google).not.toHaveBeenCalled();
  expect(ctx.manager.establishSession).not.toHaveBeenCalled();
});

test('a session change while the prompt is open discards the token unsent', async () => {
  const pending = deferred();
  const ctx = setup({
    google: { requestIdToken: jest.fn(() => pending.promise) },
  });
  await ctx.render(SignInScreen);
  await press(GOOGLE);
  ctx.state.generation = 2; // signed out / another account took over meanwhile
  await act(async () => pending.resolve({ kind: 'token', idToken: TOKEN }));
  expect(ctx.api.google).not.toHaveBeenCalled();
  expect(ctx.manager.establishSession).not.toHaveBeenCalled();
});

describe('native SDK adapter', () => {
  const statusCodes = {
    SIGN_IN_CANCELLED: 'CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY',
  };
  function sdk(signIn) {
    const GoogleSignin = {
      configure: jest.fn(),
      hasPlayServices: jest.fn(async () => true),
      signIn: jest.fn(signIn),
      signOut: jest.fn(async () => null),
    };
    return {
      GoogleSignin,
      statusCodes,
      isErrorWithCode: (error) => !!error && typeof error.code === 'string',
    };
  }
  const codeError = (code) => Object.assign(new Error('details'), { code });

  test('missing config or native module means no provider', () => {
    expect(createGoogleProvider(null, sdk(), 'android')).toBeNull();
    expect(
      createGoogleProvider({ webClientId: WEB }, null, 'android'),
    ).toBeNull();
  });

  test('Android requests only an ID token for the Web client after Play services check', async () => {
    const s = sdk(async () => ({ type: 'success', data: { idToken: TOKEN } }));
    const provider = createGoogleProvider({ webClientId: WEB }, s, 'android');
    await provider.reset();
    expect(s.GoogleSignin.signOut).not.toHaveBeenCalled();
    await expect(provider.requestIdToken()).resolves.toEqual({
      kind: 'token',
      idToken: TOKEN,
    });
    await provider.requestIdToken();
    expect(s.GoogleSignin.configure).toHaveBeenCalledTimes(1);
    expect(s.GoogleSignin.configure).toHaveBeenCalledWith({
      webClientId: WEB,
      offlineAccess: false,
    });
    expect(s.GoogleSignin.hasPlayServices).toHaveBeenCalledWith({
      showPlayServicesUpdateDialog: true,
    });
    await provider.reset();
    expect(s.GoogleSignin.signOut).toHaveBeenCalledTimes(1);
  });

  test('iOS passes its client and skips the Play services check', async () => {
    const s = sdk(async () => ({ type: 'success', data: { idToken: TOKEN } }));
    const ios = '123456789012-ios.apps.googleusercontent.com';
    const provider = createGoogleProvider(
      { webClientId: WEB, iosClientId: ios },
      s,
      'ios',
    );
    await provider.requestIdToken();
    expect(s.GoogleSignin.configure).toHaveBeenCalledWith({
      webClientId: WEB,
      iosClientId: ios,
      offlineAccess: false,
    });
    expect(s.GoogleSignin.hasPlayServices).not.toHaveBeenCalled();
  });

  test.each([
    [async () => ({ type: 'cancelled', data: null }), 'cancelled'],
    [async () => ({ type: 'success', data: { idToken: null } }), 'failed'],
    [async () => Promise.reject(codeError('CANCELLED')), 'cancelled'],
    [async () => Promise.reject(codeError('IN_PROGRESS')), 'busy'],
    [async () => Promise.reject(codeError('PLAY')), 'play-services'],
    [async () => Promise.reject(codeError('DEVELOPER_ERROR')), 'failed'],
    [async () => Promise.reject(new Error('boom')), 'failed'],
  ])('SDK outcome maps to %#', async (signIn, kind) => {
    const provider = createGoogleProvider(
      { webClientId: WEB },
      sdk(signIn),
      'android',
    );
    await expect(provider.requestIdToken()).resolves.toEqual({ kind });
  });

  test('missing Play services is reported before any sign-in prompt', async () => {
    const s = sdk(async () => ({ type: 'success', data: { idToken: TOKEN } }));
    s.GoogleSignin.hasPlayServices.mockRejectedValueOnce(codeError('PLAY'));
    const provider = createGoogleProvider({ webClientId: WEB }, s, 'android');
    await expect(provider.requestIdToken()).resolves.toEqual({
      kind: 'play-services',
    });
    expect(s.GoogleSignin.signIn).not.toHaveBeenCalled();
  });

  test('reset swallows SDK sign-out failures', async () => {
    const s = sdk(async () => ({ type: 'cancelled', data: null }));
    s.GoogleSignin.signOut.mockRejectedValueOnce(new Error('x'));
    const provider = createGoogleProvider({ webClientId: WEB }, s, 'android');
    await provider.requestIdToken();
    await expect(provider.reset()).resolves.toBeUndefined();
  });
});

test('dark theme uses theme tokens for the Google action and divider; label stays visible', async () => {
  const { ThemeContext, palettes } = jest.requireActual('../src/ui');
  const ctx = setup();
  await render(
    <ThemeContext.Provider value="dark">
      <AuthProvider
        api={ctx.api}
        manager={ctx.manager}
        flow={createAuthFlow()}
        google={ctx.provider}
      >
        <SignInScreen />
      </AuthProvider>
    </ThemeContext.Provider>,
  );
  const button = screen.getByRole('button', { name: GOOGLE });
  const style = [button.props.style].flat(Infinity).filter(Boolean);
  expect(style.some((s) => s.backgroundColor === palettes.dark.surface)).toBe(
    true,
  );
  const label = screen.getByText(GOOGLE);
  expect([label.props.style].flat(Infinity)).toContainEqual(
    expect.objectContaining({ color: palettes.dark.text, flexShrink: 1 }),
  );
  expect(
    [screen.getByText('or continue with').props.style].flat(Infinity),
  ).toContainEqual(
    expect.objectContaining({ color: palettes.dark.textSecondary }),
  );
});
