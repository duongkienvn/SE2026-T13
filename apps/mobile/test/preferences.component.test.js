/* global jest, test, expect, afterEach */
import { URL } from 'node:url';
import { Suspense, startTransition, useLayoutEffect } from 'react';
import { Text } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { NotificationPreferencesScreen } from '../src/features/notifications/preferences/NotificationPreferencesScreen';
import { createHttpClient } from '../src/infrastructure/api/client';
import {
  SessionProvider,
  useSessionSnapshot,
} from '../src/infrastructure/auth/SessionProvider';
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
import { defaults } from './notifications/preferences-fixtures';
import { queryKeys } from '../src/infrastructure/query/keys';
import Settings from '../src/app/(private)/settings';
import { usePreferences } from '../src/features/notifications/preferences/usePreferences';

test('GET cooldown survives offline/reconnect and disables Retry until Retry-After', async () => {
  const env = await setup(() => wire({}, 429, '60'));
  try {
    await screen.findByText('Too many requests. Wait before trying again.');
    const count = env.requests.length;
    expect(
      screen.getByRole('button', { name: 'Retry preferences' }),
    ).toBeDisabled();
    await act(() => onlineManager.setOnline(false));
    await act(() => onlineManager.setOnline(true));
    await act(() => focusManager.setFocused(false));
    await act(() => focusManager.setFocused(true));
    expect(env.requests).toHaveLength(count);
  } finally {
    await env.dispose();
  }
});

let mockEmailEnabled = false;
const mockBack = jest.fn(),
  mockReplace = jest.fn(),
  mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    canGoBack: () => true,
    replace: mockReplace,
    push: mockPush,
  }),
  useIsFocused: () => true,
  usePreventRemove: () => () => {},
}));
jest.mock('../src/features/notifications/preferences/config', () => ({
  get emailEnabled() {
    return mockEmailEnabled;
  },
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
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
  Content = NotificationPreferencesScreen,
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
      baseUrl: new URL('https://preferences.example.test/api'),
      clock,
      timers: clock,
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        const custom = override?.(init, server);
        if (custom) return custom;
        if (init.method === 'PATCH') {
          const patch = JSON.parse(init.body);
          server = {
            inApp: { ...server.inApp, ...patch.inApp },
            email: { ...server.email, ...patch.email },
          };
        }
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
  const tree = (entry = 0) => (
    <SessionProvider manager={manager}>
      <DataProvider layer={data}>
        <ThemeContext.Provider value={mode}>
          <Content key={entry} />
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
const toggle = async (name) =>
  fireEvent(await screen.findByRole('switch', { name }), 'valueChange', false);
afterEach(() => {
  mockEmailEnabled = false;
  onlineManager.setOnline(true);
  focusManager.setFocused(true);
  jest.useRealTimers();
});

test('authoritative loading/error retry shows no default switches', async () => {
  let finish;
  const env = await setup(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  try {
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.getByText('Loading notification preferences…')).toBeTruthy();
    await act(async () => finish(wire({}, 500)));
    await screen.findByText(
      'Couldn’t load notification preferences. Try again.',
    );
    await press('Retry preferences');
    await act(async () => finish(wire(defaults())));
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(9));
  } finally {
    await env.dispose();
  }
});

test('exactly nine accessible values, disabled email, draft-only editing, Cancel and sparse Save', async () => {
  const env = await setup();
  try {
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(9));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(
      screen.getByRole('switch', { name: 'Email: Card assignments' }),
    ).toBeDisabled();
    expect(
      screen.getByText('Not sent yet — boards add members directly today'),
    ).toBeTruthy();
    expect(screen.getByText('Always on')).toBeTruthy();
    await toggle('In-app: Card assignments');
    expect(env.requests.filter((r) => r.init.method === 'PATCH')).toHaveLength(
      0,
    );
    await press('Cancel');
    expect(
      screen.getByRole('switch', {
        name: 'In-app: Card assignments',
        checked: true,
      }),
    ).toBeTruthy();
    await toggle('In-app: Card assignments');
    await press('Save changes');
    await screen.findByText('Notification preferences saved.');
    expect(
      JSON.parse(env.requests.find((r) => r.init.method === 'PATCH').init.body),
    ).toEqual({ inApp: { cardAssigned: false } });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  } finally {
    await env.dispose();
  }
});

test('flag-on email edits use a sparse separate channel and best-effort copy in dark mode', async () => {
  mockEmailEnabled = true;
  const env = await setup(undefined, 'dark');
  try {
    const email = await screen.findByRole('switch', {
      name: 'Email: Due date reminders',
    });
    expect(email).not.toBeDisabled();
    await fireEvent(email, 'valueChange', true);
    expect(
      screen.getByText(/Optional task emails. Delivery is best-effort/),
    ).toBeTruthy();
    await press('Save changes');
    await screen.findByText('Notification preferences saved.');
    expect(
      JSON.parse(env.requests.find((r) => r.init.method === 'PATCH').init.body),
    ).toEqual({ email: { dueReminder: true } });
  } finally {
    await env.dispose();
  }
});

test('dirty refetch adopts untouched leaves, requires review and saves only explicit local changes', async () => {
  const env = await setup();
  try {
    await toggle('In-app: Card assignments');
    env.server.inApp.membershipChanged = false;
    env.server.email.dueReminder = true;
    await act(() =>
      env.data.queryClient.invalidateQueries({
        queryKey: queryKeys.notificationPreferences(env.data.getIdentity()),
        exact: true,
      }),
    );
    await screen.findByText(/Preferences changed — review your choices/);
    expect(
      screen.getByRole('switch', {
        name: 'In-app: Card assignments',
        checked: false,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('switch', {
        name: 'In-app: Membership changes',
        checked: false,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('switch', {
        name: 'Email: Due date reminders',
        checked: true,
      }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await press('Review and keep my edits');
    await press('Save changes');
    await screen.findByText('Notification preferences saved.');
    expect(
      JSON.parse(env.requests.find((r) => r.init.method === 'PATCH').init.body),
    ).toEqual({ inApp: { cardAssigned: false } });
  } finally {
    await env.dispose();
  }
});

test('clean refetch adopts Web values; a later failing refetch keeps visible data and draft', async () => {
  let fail = false;
  const env = await setup((init) =>
    init.method === 'GET' && fail ? wire({}, 500) : null,
  );
  try {
    await screen.findByRole('switch', {
      name: 'In-app: Mentions',
      checked: true,
    });
    env.server.inApp.commentMentioned = false;
    const refresh = () =>
      env.data.queryClient.invalidateQueries({
        queryKey: queryKeys.notificationPreferences(env.data.getIdentity()),
        exact: true,
      });
    await act(refresh);
    await screen.findByRole('switch', {
      name: 'In-app: Mentions',
      checked: false,
    });
    await toggle('In-app: Card assignments');
    fail = true;
    await act(refresh);
    await screen.findByText(/Saved data may be stale; your draft is kept/);
    expect(
      screen.getByRole('switch', {
        name: 'In-app: Card assignments',
        checked: false,
      }),
    ).toBeTruthy();
    fail = false;
    await press('Retry preferences');
    await waitFor(() =>
      expect(screen.queryByText(/Saved data may be stale/)).toBeNull(),
    );
    expect(
      screen.getByRole('switch', {
        name: 'In-app: Card assignments',
        checked: false,
      }),
    ).toBeTruthy();
  } finally {
    await env.dispose();
  }
});

test('uncertain write keeps the original draft and GET observations never unlock saving', async () => {
  let finishRead,
    hold = false;
  const env = await setup((init, server) => {
    if (init.method === 'PATCH') {
      server.inApp.cardAssigned = false;
      hold = true;
      return Promise.reject(new TypeError('connection lost'));
    }
    if (hold)
      return new Promise((resolve) => {
        finishRead = resolve;
      });
    return null;
  });
  try {
    await toggle('In-app: Card assignments');
    await press('Save changes');
    await screen.findByText(/Save wasn’t confirmed/);
    expect(screen.queryByText('Notification preferences saved.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await press('Check server preferences');
    await waitFor(() => expect(finishRead).toBeTruthy());
    expect(env.requests.filter((r) => r.init.method === 'PATCH')).toHaveLength(
      1,
    );
    const observed = defaults(); // May precede the server's PATCH commit.
    await act(async () => finishRead(wire(observed)));
    await screen.findByText(
      'Server values checked. The earlier save is still unconfirmed; saving remains blocked. Your draft is unchanged.',
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(
      screen.getByRole('switch', {
        name: 'In-app: Card assignments',
        checked: false,
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /This server cannot confirm when that save has finished/,
      ),
    ).toBeTruthy();
  } finally {
    await env.dispose();
  }
});

test.each([200, 503])(
  'reconnect during a pending PATCH checks once after timeout, without a %s GET loop',
  async (status) => {
    let saving = false,
      recoveryReads = 0;
    const env = await setup((init) => {
      if (init.method === 'PATCH') {
        saving = true;
        return new Promise(() => {});
      }
      if (saving) {
        recoveryReads++;
        return wire(defaults(), status);
      }
      return null;
    });
    try {
      await toggle('In-app: Card assignments');
      await press('Save changes');
      await waitFor(() => expect(saving).toBe(true));
      await act(() => onlineManager.setOnline(false));
      await act(() => onlineManager.setOnline(true));
      expect(recoveryReads).toBe(0);
      await act(async () => env.clock.advance(15_001));
      await waitFor(() => expect(recoveryReads).toBe(1));
      await act(async () => {}); // Drain pending/publish effects after the GET.
      expect(recoveryReads).toBe(1);
      expect(
        screen.getByRole('button', { name: 'Save changes' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('switch', {
          name: 'In-app: Card assignments',
          checked: false,
        }),
      ).toBeTruthy();
    } finally {
      await env.dispose();
    }
  },
);

test('reopening an uncertain editor shows read-only observations without enabling a new draft', async () => {
  const env = await setup((init) =>
    init.method === 'PATCH'
      ? Promise.reject(new TypeError('connection lost'))
      : null,
  );
  try {
    await toggle('In-app: Card assignments');
    await press('Save changes');
    await screen.findByText(/Save wasn’t confirmed/);
    await env.remount();
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(9));
    expect(
      screen.getByRole('switch', {
        name: 'In-app: Card assignments',
        checked: true,
      }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.queryByText('Loading notification preferences…')).toBeNull();
    expect(
      screen.getByText(/Checking values cannot unlock saving/),
    ).toBeTruthy();
    expect(env.requests.filter((r) => r.init.method === 'PATCH')).toHaveLength(
      1,
    );
  } finally {
    await env.dispose();
  }
});

test('Save uses the committed draft while a newer concurrent render is suspended', async () => {
  let committed,
    suspend = false,
    suspended = false;
  const never = new Promise(() => {});
  function Editor() {
    const session = useSessionSnapshot();
    const editor = usePreferences({
      userId: session.user.id,
      generation: session.generation,
    });
    useLayoutEffect(() => {
      committed = editor;
    });
    if (suspend && editor.form?.draft.inApp.cardAssigned) {
      suspended = true;
      throw never;
    }
    return (
      <Text>
        {editor.dirty ? 'Committed dirty draft' : 'Committed clean draft'}
      </Text>
    );
  }
  const env = await setup(undefined, 'light', () => (
    <Suspense fallback={<Text>Suspended editor</Text>}>
      <Editor />
    </Suspense>
  ));
  try {
    await waitFor(() => expect(committed?.form).toBeTruthy());
    await act(() => {
      committed.edit('inApp', 'cardAssigned', false);
      committed.edit('inApp', 'dueReminder', false);
    });
    expect(committed.canSave).toBe(true);
    suspend = true;
    await act(() =>
      startTransition(() => committed.edit('inApp', 'cardAssigned', true)),
    );
    expect(suspended).toBe(true);
    expect(screen.getByText('Committed dirty draft')).toBeTruthy();
    await act(async () => committed.save());
    expect(
      JSON.parse(env.requests.find((r) => r.init.method === 'PATCH').init.body),
    ).toEqual({ inApp: { cardAssigned: false, dueReminder: false } });
  } finally {
    await env.dispose();
  }
});

test('slow save blocks duplicate taps, editing and refetch and adopts full authoritative ACK', async () => {
  let finish;
  const env = await setup((init) =>
    init.method === 'PATCH'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : null,
  );
  try {
    await toggle('In-app: Card assignments');
    await press('Save changes');
    await screen.findByText('Saving preferences… Please wait before leaving.');
    await press('Save changes');
    expect(
      screen.getByRole('switch', { name: 'In-app: Mentions' }),
    ).toBeDisabled();
    await act(() => focusManager.setFocused(false));
    await act(() => focusManager.setFocused(true));
    expect(env.requests.filter((r) => r.init.method === 'PATCH')).toHaveLength(
      1,
    );
    const authoritative = defaults();
    authoritative.inApp.cardAssigned = false;
    authoritative.email.dueReminder = true;
    await act(async () => finish(wire(authoritative)));
    await screen.findByText('Notification preferences saved.');
    expect(
      screen.getByRole('switch', {
        name: 'Email: Due date reminders',
        checked: true,
      }),
    ).toBeTruthy();
    await toggle('In-app: Mentions');
    expect(
      screen.getByRole('switch', { name: 'In-app: Mentions', checked: false }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Save changes' }),
    ).not.toBeDisabled();
  } finally {
    await env.dispose();
  }
});

test('offline draft survives reconnect with no queued write', async () => {
  const env = await setup();
  try {
    await toggle('In-app: Card assignments');
    await act(() => onlineManager.setOnline(false));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByText(/You’re offline. Your draft is kept/)).toBeTruthy();
    await act(() => onlineManager.setOnline(true));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save changes' }),
      ).not.toBeDisabled(),
    );
    expect(
      screen.getByRole('switch', {
        name: 'In-app: Card assignments',
        checked: false,
      }),
    ).toBeTruthy();
    expect(env.requests.filter((r) => r.init.method === 'PATCH')).toHaveLength(
      0,
    );
  } finally {
    await env.dispose();
  }
});

test('logout during save and A-to-B switch never flash A values or accept A ACK', async () => {
  let finishSave, finishB;
  let holdB = false;
  const env = await setup((init) =>
    init.method === 'PATCH'
      ? new Promise((resolve) => {
          finishSave = resolve;
        })
      : holdB
        ? new Promise((resolve) => {
            finishB = resolve;
          })
        : null,
  );
  const oldIdentity = env.data.getIdentity();
  try {
    await toggle('In-app: Card assignments');
    await press('Save changes');
    await waitFor(() => expect(finishSave).toBeTruthy());
    await act(async () => {
      await env.manager.logout();
    });
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    holdB = true;
    await act(async () => {
      await env.manager.establishSession(loginResponse(USER_B));
    });
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    await act(async () =>
      finishSave(
        wire({
          ...defaults(),
          inApp: { ...defaults().inApp, cardAssigned: false },
        }),
      ),
    );
    expect(
      env.data.queryClient.getQueryData(
        queryKeys.notificationPreferences(oldIdentity),
      ),
    ).toBeUndefined();
    await waitFor(() => expect(finishB).toBeTruthy());
    await act(async () => finishB(wire(defaults())));
    await screen.findByRole('switch', {
      name: 'In-app: Card assignments',
      checked: true,
    });
    expect(screen.queryByText('Notification preferences saved.')).toBeNull();
  } finally {
    await env.dispose();
  }
});

test('400 preserves supported choices for correction; 401 removes protected switches', async () => {
  for (const status of [400, 401]) {
    const env = await setup((init) =>
      init.method === 'PATCH' ? wire({}, status) : null,
    );
    try {
      await toggle('In-app: Card assignments');
      await press('Save changes');
      if (status === 400) {
        await screen.findByText(
          'The server rejected these preference changes. Only supported on/off choices can be saved.',
        );
        expect(
          screen.getByRole('switch', {
            name: 'In-app: Card assignments',
            checked: false,
          }),
        ).toBeTruthy();
        expect(
          screen.getByRole('button', { name: 'Save changes' }),
        ).not.toBeDisabled();
      } else {
        await waitFor(() =>
          expect(screen.queryAllByRole('switch')).toHaveLength(0),
        );
        expect(env.data.getIdentity()).toBeNull();
      }
      expect(screen.queryByText('Notification preferences saved.')).toBeNull();
    } finally {
      await env.dispose();
    }
  }
});

test('write rate-limit cooldown disables Save without losing the draft', async () => {
  const env = await setup((init) =>
    init.method === 'PATCH' ? wire({}, 429, '60') : null,
  );
  try {
    await toggle('In-app: Card assignments');
    await press('Save changes');
    await screen.findByText('Too many requests. Wait before trying again.');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(
      screen.getByRole('switch', {
        name: 'In-app: Card assignments',
        checked: false,
      }),
    ).toBeTruthy();
    await act(() => onlineManager.setOnline(false));
    await act(() => onlineManager.setOnline(true));
    expect(env.requests.filter((r) => r.init.method === 'PATCH')).toHaveLength(
      1,
    );
  } finally {
    await env.dispose();
  }
});

test('Settings exposes the scoped preferences entry', async () => {
  mockPush.mockClear();
  const env = await setup(undefined, 'light', Settings);
  try {
    await press('Notification preferences');
    expect(mockPush).toHaveBeenCalledWith('/notification-preferences');
  } finally {
    await env.dispose();
  }
});
