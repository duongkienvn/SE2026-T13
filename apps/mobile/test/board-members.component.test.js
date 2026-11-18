/* global jest, test, expect */
import { URL } from 'node:url';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';
import { FlatList, StyleSheet, useColorScheme } from 'react-native';
import MembersRoute from '../src/app/(private)/boards/[boardId]/members';
import { createHttpClient } from '../src/infrastructure/api/client';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { createSessionManager } from '../src/infrastructure/auth/session-manager';
import { createCredentialStore } from '../src/infrastructure/auth/credential-store';
import { createMobileDataLayer } from '../src/infrastructure/query/data-layer';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { queryKeys } from '../src/infrastructure/query/keys';
import { createNativeRealtime } from '../src/infrastructure/realtime/client';
import { RealtimeProvider } from '../src/infrastructure/realtime/RealtimeProvider';
import { SessionProvider as NavigationProvider } from '../src/navigation/session-context';
import { createNavigationSessionAdapter } from '../src/navigation/native-session-adapter';
import { Button, ThemeContext, palettes } from '../src/ui';
import {
  FakeSessionApi,
  FakeTime,
  MemorySecureStore,
  USER_A,
  USER_B,
  deferred,
  loginResponse,
  user,
} from './auth/support';
import {
  actor,
  boardId,
  member,
  membershipBoard,
  policy,
} from './board-members/fixtures';
import { page } from './workspaces/fixtures';

let mockFocus = true;
// Load RN's lazy list module before the first interaction's timeout starts.
void FlatList;
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useIsFocused: () => mockFocus,
  useLocalSearchParams: () => ({
    boardId: '11111111-1111-4111-8111-111111111111',
  }),
  usePathname: () => '/boards/11111111-1111-4111-8111-111111111111/members',
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  const descriptors = Object.getOwnPropertyDescriptors(native);
  descriptors.Modal = {
    configurable: true,
    enumerable: true,
    value: ({ visible, onRequestClose, children }) =>
      visible ? (
        <native.View testID="native-modal" onTouchEnd={onRequestClose}>
          {children}
        </native.View>
      ) : null,
  };
  descriptors.useWindowDimensions = {
    configurable: true,
    enumerable: true,
    value: () => ({ width: 320, height: 568, scale: 2, fontScale: 1.6 }),
  };
  descriptors.useColorScheme = {
    configurable: true,
    enumerable: true,
    value: jest.fn(() => 'light'),
  };
  return Object.create(Object.getPrototypeOf(native), descriptors);
});
const response = (data, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {
    get: (name) =>
      name === 'content-type' && status !== 204 ? 'application/json' : null,
  },
  text: async () => (status === 204 ? '' : JSON.stringify(data)),
});
const ok = (data, status = 200) =>
  response({ success: true, statusCode: status, message: 'OK', data }, status);
const failure = (status, message = 'Request failed') =>
  response(
    { success: false, statusCode: status, code: 'CONFLICT', message },
    status,
  );

async function setup({
  board = membershipBoard(),
  members = [actor, member()],
  capabilities = policy,
  override,
  theme = 'light',
  seed,
} = {}) {
  mockFocus = true;
  useColorScheme.mockReturnValue('light');
  onlineManager.setOnline(true);
  const time = new FakeTime();
  const auth = new FakeSessionApi();
  auth.auto = () => ({ kind: 'verified', user: user(USER_A) });
  const manager = createSessionManager({
    api: auth,
    store: createCredentialStore(new MemorySecureStore()),
    clock: time,
    timers: time,
  });
  await manager.establishSession(loginResponse(USER_A));
  const state = { board, members, policy: { ...capabilities } };
  const calls = [];
  const fetch = async (input, init) => {
    const url = new URL(input);
    const call = {
      path: url.pathname,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body) : undefined,
      page: Number(url.searchParams.get('page')),
      limit: Number(url.searchParams.get('limit')),
    };
    calls.push(call);
    const custom = await override?.(call, state);
    if (custom) return custom;
    if (call.path === `/api/boards/${boardId}`) return ok(state.board);
    if (call.path.endsWith('/policy-capabilities')) return ok(state.policy);
    if (call.path.endsWith('/members') && call.method === 'GET')
      return response(page(state.members, call.page, call.limit));
    if (call.path.endsWith('/members') && call.method === 'POST') {
      const added = {
        ...member(100),
        user: { ...member(100).user, email: call.body.email },
      };
      state.members = [...state.members, added];
      return ok(added, 201);
    }
    if (call.path.includes('/members/') && call.method === 'PATCH') {
      state.members = state.members.map((row) =>
        row.user.id === call.path.split('/').at(-1)
          ? { ...row, role: call.body.role }
          : row,
      );
      return ok(
        state.members.find(
          (row) => row.user.id === call.path.split('/').at(-1),
        ),
      );
    }
    if (call.path.includes('/members/') && call.method === 'DELETE') {
      state.members = state.members.filter(
        (row) => row.user.id !== call.path.split('/').at(-1),
      );
      return response(null, 204);
    }
    return failure(404);
  };
  const data = createMobileDataLayer(
    manager,
    createHttpClient({ baseUrl: new URL('https://example.test/api'), fetch }),
    time,
  );
  data.queryClient.setDefaultOptions({
    queries: {
      ...data.queryClient.getDefaultOptions().queries,
      gcTime: Infinity,
    },
  });
  seed?.(data);
  const realtime = createNativeRealtime({
    manager,
    data,
    createSocket: null,
    timers: time,
  });
  realtime.setEnvironment({ foreground: true, online: true });
  const adapter = createNavigationSessionAdapter(manager);
  const mounted = await render(
    <SessionProvider manager={manager}>
      <DataProvider layer={data}>
        <RealtimeProvider client={realtime}>
          <NavigationProvider adapter={adapter}>
            <ThemeContext.Provider value={theme}>
              <MembersRoute />
            </ThemeContext.Provider>
          </NavigationProvider>
        </RealtimeProvider>
      </DataProvider>
    </SessionProvider>,
  );
  return {
    data,
    manager,
    time,
    state,
    calls,
    mounted,
    async systemTheme(mode) {
      useColorScheme.mockReturnValue(mode);
      await mounted.rerender(
        <SessionProvider manager={manager}>
          <DataProvider layer={data}>
            <RealtimeProvider client={realtime}>
              <NavigationProvider adapter={adapter}>
                <ThemeContext.Provider value={theme}>
                  <MembersRoute />
                </ThemeContext.Provider>
              </NavigationProvider>
            </RealtimeProvider>
          </DataProvider>
        </SessionProvider>,
      );
    },
    writes: () => calls.filter(({ method }) => method !== 'GET'),
    async dispose() {
      await mounted.unmount();
      realtime.dispose();
      data.dispose();
      manager.dispose();
      onlineManager.setOnline(true);
    },
  };
}
const press = async (name) =>
  fireEvent.press(await screen.findByRole('button', { name }));
const waitRoster = () =>
  screen.findByText('member1@example.test', {}, { timeout: 5000 });

test('explicit member gets full roster and role labels; no global search or mutation controls', async () => {
  const c = await setup({
    board: membershipBoard({ currentUserRole: 'MEMBER' }),
  });
  try {
    await waitRoster();
    expect(screen.getAllByText('Board OWNER').length).toBeGreaterThan(0);
    expect(screen.getByText('Board MEMBER')).toBeTruthy();
    expect(screen.getAllByText(/Joined /).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: 'Add existing Kanvexa user' }),
    ).toBeNull();
    expect(screen.queryByRole('search')).toBeNull();
    expect(
      c.calls.some(({ path }) => path.endsWith('/policy-capabilities')),
    ).toBe(false);
  } finally {
    await c.dispose();
  }
});

test.each([null, undefined])(
  'Workspace-only reader, including ADMIN hint %s, cannot fetch or flash seeded roster',
  async () => {
    const c = await setup({
      board: membershipBoard({ currentUserRole: null, workspaceRole: 'ADMIN' }),
      seed(data) {
        data.queryClient.setQueryData(
          [
            ...queryKeys.members(data.getIdentity(), boardId),
            'directory',
            { page: 1, limit: 20 },
          ],
          page([member()], 1, 20),
        );
      },
    });
    try {
      expect(screen.queryByText('member1@example.test')).toBeNull();
      await screen.findByText('Board member access restricted');
      expect(c.calls.some(({ path }) => path.endsWith('/members'))).toBe(false);
      expect(screen.queryByText('member1@example.test')).toBeNull();
      expect(screen.queryByText('Board OWNER')).toBeNull();
    } finally {
      await c.dispose();
    }
  },
);

test.each(['OWNER', 'MEMBER'])(
  'archived explicit %s roster is read only',
  async (role) => {
    const c = await setup({
      board: membershipBoard({
        currentUserRole: role,
        isArchived: true,
        archivedAt: '2026-11-15T09:00:00.000Z',
      }),
    });
    try {
      await waitRoster();
      expect(screen.getByText(/Archived Board/)).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: 'Add existing Kanvexa user' }),
      ).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Actions for Member 1' }),
      ).toBeNull();
    } finally {
      await c.dispose();
    }
  },
);

test.each([
  [true, false],
  [false, true],
  [false, false],
])(
  'independent invite=%s / change=%s policies for guest Board OWNER',
  async (invite, change) => {
    const c = await setup({
      board: membershipBoard({ workspaceRole: null }),
      capabilities: {
        ...policy,
        canInviteMembers: invite,
        canChangeMembership: change,
      },
    });
    try {
      await waitRoster();
      await waitFor(() =>
        expect(
          !!screen.queryByRole('button', { name: 'Add existing Kanvexa user' }),
        ).toBe(invite),
      );
      expect(
        !!screen.queryByRole('button', { name: 'Actions for Member 1' }),
      ).toBe(change);
      expect(c.calls.every(({ path }) => !path.includes('/workspaces/'))).toBe(
        true,
      );
    } finally {
      await c.dispose();
    }
  },
);

test('add existing email validates, sends once, creates MEMBER after 201 and reconciles', async () => {
  const c = await setup();
  try {
    await waitRoster();
    await press('Add existing Kanvexa user');
    const field = screen.getByLabelText('Kanvexa account email');
    expect(field.props.maxLength).toBe(320);
    expect(field.props.keyboardType).toBe('email-address');
    await fireEvent.changeText(field, 'bad');
    await press('Add to Board');
    expect(screen.getByText(/Enter a valid email/)).toBeTruthy();
    expect(c.writes()).toHaveLength(0);
    await fireEvent.changeText(field, ' NEW@example.test ');
    await press('Add to Board');
    await screen.findByText('Board member added.');
    await screen.findByText('new@example.test');
    expect(c.writes()).toEqual([
      expect.objectContaining({
        method: 'POST',
        body: { email: 'new@example.test' },
      }),
    ]);
    expect(screen.queryByText(/Send invitation/)).toBeNull();
  } finally {
    await c.dispose();
  }
});

test.each([
  [404, 'User not found'],
  [409, 'User is already a member of this board'],
  [403, 'Policy denied'],
  [429, 'Too many requests'],
])(
  'add error %s preserves draft and does not show success',
  async (status, message) => {
    const c = await setup({
      override: (call) =>
        call.method === 'POST' ? failure(status, message) : undefined,
    });
    try {
      await waitRoster();
      await press('Add existing Kanvexa user');
      await fireEvent.changeText(
        screen.getByLabelText('Kanvexa account email'),
        'new@example.test',
      );
      await press('Add to Board');
      await waitFor(() => expect(c.writes()).toHaveLength(1));
      await waitFor(() =>
        expect(screen.getByLabelText('Kanvexa account email').props.value).toBe(
          'new@example.test',
        ),
      );
      expect(screen.queryByText('Board member added.')).toBeNull();
    } finally {
      await c.dispose();
    }
  },
);

test('uncertain 503 requires checking REST before another explicit action', async () => {
  const c = await setup({
    override: (call) => (call.method === 'POST' ? failure(503) : undefined),
  });
  try {
    await waitRoster();
    await press('Add existing Kanvexa user');
    await fireEvent.changeText(
      screen.getByLabelText('Kanvexa account email'),
      'new@example.test',
    );
    await press('Add to Board');
    await screen.findByRole('button', { name: 'Check latest members' });
    expect(screen.getByRole('button', { name: 'Add to Board' })).toBeDisabled();
    await press('Check latest members');
    await screen.findByText(/Latest members loaded/);
    expect(c.writes()).toHaveLength(1);
  } finally {
    await c.dispose();
  }
});

test('two taps before rerender keep the original pending request and prevent a duplicate submit', async () => {
  const gate = deferred();
  const c = await setup({
    override: (call, state) =>
      call.method === 'POST'
        ? gate.promise.then(() => {
            const added = {
              ...member(100),
              user: { ...member(100).user, email: call.body.email },
            };
            state.members.push(added);
            return ok(added, 201);
          })
        : undefined,
  });
  try {
    await waitRoster();
    await press('Add existing Kanvexa user');
    await fireEvent.changeText(
      screen.getByLabelText('Kanvexa account email'),
      'new@example.test',
    );
    // Capture one pre-commit closure: ordinary awaited events flush a rerender.
    let fiber = screen.getByRole('button', {
      name: 'Add to Board',
    }).unstable_fiber;
    while (fiber && fiber.type !== Button) fiber = fiber.return;
    const submit = fiber.memoizedProps.onPress;
    await act(async () => {
      submit();
      submit();
    });
    await waitFor(() => expect(c.writes()).toHaveLength(1));
    expect(
      screen.getByRole('button', { name: 'Add to Board' }).props
        .accessibilityState,
    ).toMatchObject({ busy: true, disabled: true });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => gate.resolve());
    await screen.findByText('Board member added.');
  } finally {
    gate.resolve();
    await c.dispose();
  }
});

test('role selection confirms promotion and demotion using exact Board roles', async () => {
  const c = await setup();
  try {
    await waitRoster();
    await press('Actions for Member 1');
    await press('Change role');
    await fireEvent.press(screen.getByRole('radio', { name: 'OWNER' }));
    await press('Review role change');
    expect(screen.getByText('Promote Member 1 to OWNER?')).toBeTruthy();
    expect(c.writes()).toHaveLength(0);
    await press('Confirm role change');
    await screen.findByText('Board role updated.');
    expect(c.writes()[0].body).toEqual({ role: 'OWNER' });
    await press('Actions for Member 1');
    await press('Change role');
    await fireEvent.press(screen.getByRole('radio', { name: 'MEMBER' }));
    await press('Review role change');
    expect(screen.getByText('Demote Member 1 to MEMBER?')).toBeTruthy();
    await press('Confirm role change');
    await waitFor(() => expect(c.writes()).toHaveLength(2));
  } finally {
    await c.dispose();
  }
});

test('creator and self have explanation and disabled actions', async () => {
  const creator = {
    ...member(2, 'OWNER'),
    user: { ...member(2).user, id: membershipBoard().createdById },
  };
  const c = await setup({ members: [actor, member(), creator] });
  try {
    await waitRoster();
    expect(
      screen.getByRole('button', { name: 'Actions for Current owner' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Actions for Member 2' }),
    ).toBeDisabled();
    expect(screen.getByText(/creator cannot be demoted/)).toBeTruthy();
  } finally {
    await c.dispose();
  }
});

test('remove names the person and Card assignment effect; no early removal before 204', async () => {
  const gate = deferred();
  const c = await setup({
    override: (call, state) => {
      if (call.method !== 'DELETE') return;
      return gate.promise.then(() => {
        state.members = [actor];
        return response(null, 204);
      });
    },
  });
  try {
    await waitRoster();
    await press('Actions for Member 1');
    await press('Remove member');
    expect(screen.getByText('Remove Member 1?')).toBeTruthy();
    expect(
      screen.getByText(/clear their assignments from all its Cards/),
    ).toBeTruthy();
    await press('Remove from Board');
    await waitFor(() => expect(c.writes()).toHaveLength(1));
    expect(
      screen.getByRole('button', { name: 'Remove from Board' }),
    ).toBeDisabled();
    expect(screen.getByText('member1@example.test')).toBeTruthy();
    await fireEvent(screen.getByTestId('native-modal'), 'touchEnd');
    expect(screen.getByText('Remove Member 1?')).toBeTruthy();
    await act(async () => gate.resolve());
    await screen.findByText('Board member removed. Card assignments cleared.');
    await waitFor(() =>
      expect(screen.queryByText('member1@example.test')).toBeNull(),
    );
  } finally {
    gate.resolve();
    await c.dispose();
  }
});

test('server conflict does not change role or pretend removal succeeded', async () => {
  const c = await setup({
    override: (call) =>
      call.method === 'DELETE'
        ? failure(409, 'The board must retain at least one OWNER')
        : undefined,
  });
  try {
    await waitRoster();
    await press('Actions for Member 1');
    await press('Remove member');
    await press('Remove from Board');
    await screen.findAllByText(/must retain at least one OWNER/);
    expect(c.state.members).toHaveLength(2);
    expect(screen.queryByText(/Board member removed/)).toBeNull();
  } finally {
    await c.dispose();
  }
});

test('101 members paginate server pages without rendering whole roster', async () => {
  const c = await setup({
    members: Array.from({ length: 101 }, (_, n) => member(n + 1)),
  });
  try {
    await waitRoster();
    expect(screen.getByText('101 Board members · Page 1 of 6')).toBeTruthy();
    expect(screen.queryByText('member21@example.test')).toBeNull();
    await press('Next page');
    await screen.findByText('member21@example.test');
    expect(screen.queryByText('member1@example.test')).toBeNull();
    expect(
      c.calls
        .filter(({ path }) => path.endsWith('/members'))
        .map(({ page, limit }) => [page, limit]),
    ).toEqual([
      [1, 20],
      [2, 20],
    ]);
    await press('Previous page');
    await waitRoster();
  } finally {
    await c.dispose();
  }
});

test.each(['light', 'dark', 'system'])(
  '320dp / 160%% harness: long names/emails, selectable text, theme %s',
  async (theme) => {
    const long = {
      ...member(),
      user: {
        ...member().user,
        displayName: 'A very long member name '.repeat(6),
        email: `${'x'.repeat(307)}@example.test`,
      },
    };
    const c = await setup({ members: [long], theme });
    try {
      const email = await screen.findByText(long.user.email);
      expect(email.props.selectable).toBe(true);
      expect(email.props.numberOfLines).toBeUndefined();
      expect(
        screen.getByText(long.user.displayName).props.numberOfLines,
      ).toBeUndefined();
      if (theme !== 'system')
        expect(StyleSheet.flatten(email.props.style).color).toBe(
          palettes[theme].textSecondary,
        );
      if (theme === 'system') {
        await c.systemTheme('dark');
        expect(
          StyleSheet.flatten(screen.getByText(long.user.email).props.style)
            .color,
        ).toBe(palettes.dark.textSecondary);
        await c.systemTheme('light');
        expect(
          StyleSheet.flatten(screen.getByText(long.user.email).props.style)
            .color,
        ).toBe(palettes.light.textSecondary);
      }
      await press('Add existing Kanvexa user');
      expect(
        screen.getByLabelText('Kanvexa account email').props.editable,
      ).toBe(true);
    } finally {
      await c.dispose();
    }
  },
);

test('Back prompts for dirty email and then closes form; cancelled remove sends nothing', async () => {
  const c = await setup();
  try {
    await waitRoster();
    await press('Add existing Kanvexa user');
    await fireEvent.changeText(
      screen.getByLabelText('Kanvexa account email'),
      'new@example.test',
    );
    await fireEvent(screen.getByTestId('native-modal'), 'touchEnd');
    expect(screen.getByText('Discard email draft?')).toBeTruthy();
    await press('Keep editing');
    expect(screen.getByLabelText('Kanvexa account email').props.value).toBe(
      'new@example.test',
    );
    await press('Cancel');
    await press('Discard draft');
    await press('Actions for Member 1');
    await press('Remove member');
    await press('Cancel');
    expect(c.writes()).toHaveLength(0);
  } finally {
    await c.dispose();
  }
});

test('offline hides protected roster, blocks writes and recovers after reconnect', async () => {
  const c = await setup();
  try {
    await waitRoster();
    await act(async () => onlineManager.setOnline(false));
    await screen.findByText('Connection unavailable');
    expect(screen.queryByText('member1@example.test')).toBeNull();
    expect(c.writes()).toHaveLength(0);
    await act(async () => onlineManager.setOnline(true));
    await waitRoster();
  } finally {
    await c.dispose();
  }
});

test('logout/account switch during delayed roster never restores old private details', async () => {
  const gate = deferred();
  let delayed = false;
  const c = await setup({
    override: (call) =>
      delayed && call.path.endsWith('/members') ? gate.promise : undefined,
  });
  try {
    await waitRoster();
    const identity = c.data.getIdentity();
    delayed = true;
    await act(async () => {
      void c.data.queryClient.invalidateQueries({
        queryKey: queryKeys.members(identity, boardId),
      });
    });
    await act(async () => c.manager.establishSession(loginResponse(USER_B)));
    gate.resolve(response(page([member()], 1, 20)));
    await act(async () => {});
    expect(screen.queryByText('member1@example.test')).toBeNull();
    expect(
      c.data.queryClient.getQueryData([
        ...queryKeys.members(identity, boardId),
        'directory',
        { page: 1, limit: 20 },
      ]),
    ).toBeUndefined();
  } finally {
    gate.resolve(response(page([], 1, 20)));
    await c.dispose();
  }
});

test('forbidden roster shows restricted/error state, never fake empty or seeded private details', async () => {
  const c = await setup({
    override: (call) =>
      call.path.endsWith('/members') ? failure(403) : undefined,
  });
  try {
    await screen.findByRole('button', { name: 'Retry members' });
    expect(screen.queryByText('member1@example.test')).toBeNull();
    expect(
      screen.queryByText(/No explicit Board members were returned/),
    ).toBeNull();
  } finally {
    await c.dispose();
  }
});
