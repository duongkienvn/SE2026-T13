/* global jest, test, expect */
import { URL } from 'node:url';

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { BoardsScreen } from '../src/features/workspaces/BoardsScreen';
import { WorkspaceOverviewScreen } from '../src/features/workspaces/WorkspaceOverviewScreen';
import { WorkspaceCollaborationScreen } from '../src/features/workspaces/membership/WorkspaceCollaborationScreen';
import { WorkspaceSelectionProvider } from '../src/features/workspaces/WorkspaceSelection';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { createMobileDataLayer } from '../src/infrastructure/query/data-layer';
import { queryKeys } from '../src/infrastructure/query/keys';
import { createNativeRealtime } from '../src/infrastructure/realtime/client';
import { RealtimeProvider } from '../src/infrastructure/realtime/RealtimeProvider';
import {
  createHttpClient,
  MAX_AUTOMATIC_RETRY_DELAY_MS,
} from '../src/infrastructure/api/client';
import { ApiError } from '../src/infrastructure/api/errors';
import { canRetryWorkspace } from '../src/features/workspaces/status';
import { createSessionManager } from '../src/infrastructure/auth/session-manager';
import { createCredentialStore } from '../src/infrastructure/auth/credential-store';
import { SessionProvider as NavigationProvider } from '../src/navigation/session-context';
import { createNavigationSessionAdapter } from '../src/navigation/native-session-adapter';
import { ThemeContext } from '../src/ui';
import {
  FakeSessionApi,
  FakeTime,
  MemorySecureStore,
  loginResponse,
  user,
  USER_A,
  USER_B,
} from './auth/support';
import { board, overview, page, uuid, workspace } from './workspaces/fixtures';

const mockNavigate = jest.fn();
let mockPath = '/boards';
let mockFocused = true;
let mockPreventRemove;
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate, push: mockNavigate }),
  usePathname: () => mockPath,
  useIsFocused: () => mockFocused,
  usePreventRemove: (prevent, listener) => {
    mockPreventRemove = prevent ? listener : undefined;
  },
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
  descriptors.RefreshControl = {
    configurable: true,
    enumerable: true,
    value: ({ onRefresh, refreshing }) => (
      <native.View
        testID="workspace-refresh"
        onTouchEnd={onRefresh}
        accessibilityState={{ busy: refreshing }}
      />
    ),
  };
  return Object.create(Object.getPrototypeOf(native), descriptors);
});

const a = workspace(1, 'PERSONAL');
const b = {
  ...workspace(2),
  name: 'Design and research\nLong name with multiple lines',
};
const c = workspace(3);
const savedA = { ...board(a.id), name: 'Personal planning' };
const savedB = { ...board(b.id, 2), name: 'Team roadmap' };
function envelope(result, status = 200, retryAfter = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (key) =>
        key === 'content-type'
          ? 'application/json'
          : key === 'retry-after'
            ? retryAfter
            : null,
    },
    text: async () => JSON.stringify(result),
  };
}
const ok = (data) =>
  envelope({ success: true, statusCode: 200, message: 'OK', data });
const fail = (status) => envelope({}, status);

async function setup({
  first = [b, a],
  boards = [savedA, savedB],
  override,
  view = 'boards',
} = {}) {
  mockNavigate.mockClear();
  mockFocused = true;
  const time = new FakeTime();
  const sessionApi = new FakeSessionApi();
  sessionApi.auto = (token) => ({
    kind: 'verified',
    user: user(token === loginResponse(USER_B).accessToken ? USER_B : USER_A),
  });
  const manager = createSessionManager({
    api: sessionApi,
    store: createCredentialStore(new MemorySecureStore()),
    clock: time,
    timers: time,
  });
  await manager.establishSession(loginResponse(USER_A));
  const fetch = jest.fn(async (input, init) => {
    const url = new URL(input);
    const custom = override?.(url, init);
    if (custom) return custom;
    if (url.pathname === '/api/boards' && init.method === 'GET')
      return envelope(page([], Number(url.searchParams.get('page')), 20));
    const [, , , id, endpoint] = url.pathname.split('/');
    const joined = manager.getSnapshot().user?.id === USER_B ? [c] : first;
    if (!id)
      return envelope(page(joined, Number(url.searchParams.get('page')), 20));
    const row = joined.find((entry) => entry.id === id);
    if (!row) return fail(404);
    if (endpoint === 'overview') return ok(overview(row));
    if (endpoint === 'boards')
      return envelope(
        page(
          boards.filter(
            (item) =>
              item.workspaceId === id &&
              (url.searchParams.get('starred') !== 'true' || item.isStarred),
          ),
          Number(url.searchParams.get('page')),
          20,
        ),
      );
    return ok(row);
  });
  const data = createMobileDataLayer(
    manager,
    createHttpClient({ baseUrl: new URL('https://example.test/api'), fetch }),
    time,
  );
  data.queryClient.setDefaultOptions({
    queries: { gcTime: Infinity, retry: false, staleTime: 30_000 },
  });
  const adapter = createNavigationSessionAdapter(manager);
  const realtime = createNativeRealtime({
    manager,
    data,
    createSocket: null,
    timers: time,
  });
  const tree = (shown) => (
    <SessionProvider manager={manager}>
      <DataProvider layer={data}>
        <WorkspaceSelectionProvider>
          <NavigationProvider adapter={adapter}>
            <ThemeContext.Provider value="dark">
              {shown === 'boards' && <BoardsScreen />}
              {shown === 'overview' && <WorkspaceOverviewScreen />}
              {shown === 'collaboration' && (
                <RealtimeProvider client={realtime}>
                  <WorkspaceCollaborationScreen />
                </RealtimeProvider>
              )}
            </ThemeContext.Provider>
          </NavigationProvider>
        </WorkspaceSelectionProvider>
      </DataProvider>
    </SessionProvider>
  );
  const mounted = await render(tree(view));
  return {
    time,
    manager,
    data,
    fetch,
    show: (shown) => mounted.rerender(tree(shown)),
    async dispose() {
      await mounted.unmount();
      realtime.dispose();
      data.dispose();
      manager.dispose();
    },
  };
}

const trigger = () =>
  screen.findByRole('button', {
    name: /^Switch workspace\. Current workspace/,
  });
const openBoardEditor = async (name) => {
  await fireEvent.press(
    await screen.findByRole('button', { name: `More actions for ${name}` }),
  );
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Edit details' }),
  );
};
const switchTo = async (label) => {
  await fireEvent.press(await trigger());
  await fireEvent.press(await screen.findByRole('button', { name: label }));
};

const collaborationAdmin = { ...b, role: 'ADMIN', canManage: true };
const memberFixture = (index) => ({
  userId: index === 0 ? USER_A : uuid(600 + index),
  displayName: index === 0 ? 'Current administrator' : `Roster member ${index}`,
  avatarUrl: null,
  avatarRevision: 0,
  role: index === 0 ? 'ADMIN' : 'MEMBER',
  joinedAt: '2026-11-13T09:00:00.000Z',
});
const policyFixture = {
  boardCreationAdminOnly: false,
  boardInvitesEnabled: true,
  boardMembershipChangesEnabled: true,
  boardVisibilityChangesEnabled: true,
  canManagePolicies: true,
  canCreateBoards: true,
};
const pressWorkspace = async (name) =>
  fireEvent.press(await screen.findByRole('button', { name }));
const confirmWorkspace = async (name) =>
  fireEvent.press(
    await within(screen.getByTestId('native-modal')).findByRole('button', {
      name,
    }),
  );
const fault = (status, message) =>
  envelope(
    {
      success: false,
      statusCode: status,
      code: 'CONFLICT',
      message,
      details: [],
    },
    status,
  );

test('collaboration members page across 251 users, sends server filters, and scopes role and removal actions to other members', async () => {
  mockPath = `/workspaces/${b.id}/members`;
  let rows = Array.from({ length: 251 }, (_, index) => memberFixture(index));
  const updates = [];
  const env = await setup({
    first: [a, collaborationAdmin],
    view: 'collaboration',
    override(url, init) {
      if (url.pathname.endsWith('/members')) {
        const search = url.searchParams.get('search');
        const role = url.searchParams.get('role');
        const match = rows.filter(
          (row) =>
            (!search || row.displayName === search) &&
            (!role || row.role === role),
        );
        return envelope(page(match, Number(url.searchParams.get('page')), 20));
      }
      const target = rows.find(({ userId }) =>
        url.pathname.endsWith(`/members/${userId}`),
      );
      if (!target) return null;
      if (init.method === 'PATCH') {
        const input = JSON.parse(init.body);
        updates.push(input);
        target.role = input.role;
        return ok(target);
      }
      if (init.method === 'DELETE') {
        rows = rows.filter(({ userId }) => userId !== target.userId);
        return envelope(null, 204);
      }
      return null;
    },
  });
  try {
    await screen.findByText('251 Workspace members · Page 1 of 13');
    expect(
      screen.queryByRole('button', {
        name: 'Actions for Current administrator',
      }),
    ).toBeNull();
    await pressWorkspace('Next page');
    await screen.findByText('251 Workspace members · Page 2 of 13');
    await fireEvent.changeText(
      screen.getByLabelText('Search by display name'),
      '  Roster member 250  ',
    );
    await pressWorkspace('Search');
    await screen.findByText('1 Workspace member');
    await pressWorkspace('MEMBER');
    await waitFor(() =>
      expect(
        env.fetch.mock.calls.some(([raw]) => {
          const url = new URL(raw);
          return (
            url.searchParams.get('page') === '1' &&
            url.searchParams.get('role') === 'MEMBER' &&
            url.searchParams.get('search') === 'Roster member 250'
          );
        }),
      ).toBe(true),
    );
    await pressWorkspace('Actions for Roster member 250');
    await confirmWorkspace('Change role');
    await confirmWorkspace('Change role');
    await screen.findByText('Workspace role updated.');
    expect(updates).toEqual([{ role: 'ADMIN' }]);
    await pressWorkspace('ADMIN');
    await pressWorkspace('Actions for Roster member 250');
    await confirmWorkspace('Remove member');
    await screen.findByText(/explicit Board memberships stay in place/);
    await confirmWorkspace('Remove member');
    await screen.findByText('Workspace member removed.');
    expect(
      rows.some(({ userId }) => userId === memberFixture(250).userId),
    ).toBe(false);
  } finally {
    await env.dispose();
  }
});

test('Team leave shows last-ADMIN conflict and exits on 204 while Personal membership stays read-only', async () => {
  mockPath = `/workspaces/${b.id}/members`;
  let deny = true;
  const env = await setup({
    first: [a, collaborationAdmin],
    view: 'collaboration',
    override(url) {
      if (url.pathname.endsWith('/members'))
        return envelope(page([memberFixture(0)], 1, 20));
      if (url.pathname.endsWith('/leave'))
        return deny
          ? fault(409, 'Promote another ADMIN before leaving')
          : envelope(null, 204);
      return null;
    },
  });
  try {
    await pressWorkspace('Leave workspace');
    await confirmWorkspace('Leave workspace');
    await within(screen.getByTestId('native-modal')).findByText(
      'Promote another ADMIN before leaving',
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    deny = false;
    await confirmWorkspace('Leave workspace');
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/boards'));
    mockPath = `/workspaces/${a.id}/members`;
    await env.show('collaboration');
    await screen.findByText('Current administrator');
    expect(
      screen.queryByRole('button', { name: 'Leave workspace' }),
    ).toBeNull();
  } finally {
    await env.dispose();
  }
});

test('Guest directory displays only returned Board associations and a 403 does not expose an old roster', async () => {
  mockPath = `/workspaces/${b.id}/guests`;
  const guest = {
    user: {
      id: uuid(832),
      displayName: 'Design guest',
      avatarUrl: null,
      email: 'private@example.test',
    },
    boards: [
      {
        boardId: uuid(831),
        name: 'Archived design',
        role: 'OWNER',
        isArchived: true,
      },
    ],
    visibleBoardCount: 1,
  };
  const guestRows = [
    guest,
    ...Array.from({ length: 20 }, (_, index) => ({
      ...guest,
      user: {
        id: uuid(850 + index),
        displayName: `Other guest ${index + 1}`,
        avatarUrl: null,
      },
      boards: [
        {
          ...guest.boards[0],
          name: 'Other review',
          role: 'MEMBER',
          isArchived: false,
        },
      ],
    })),
  ];
  let firstPageRequests = 0;
  const env = await setup({
    view: 'collaboration',
    override(url) {
      if (!url.pathname.endsWith('/guests')) return null;
      if (url.searchParams.get('search') === 'deny')
        return fault(403, 'Unavailable');
      const number = Number(url.searchParams.get('page'));
      if (number === 1 && ++firstPageRequests > 1) {
        guestRows[0] = {
          ...guest,
          boards: [{ ...guest.boards[0], name: 'Rechecked design' }],
        };
      }
      return envelope(page(guestRows, number, 20));
    },
  });
  try {
    await screen.findByText('Archived design');
    expect(screen.getByText('Board OWNER')).toBeTruthy();
    expect(screen.getByText('Archived')).toBeTruthy();
    expect(screen.queryByText('private@example.test')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Change role|Remove/ }),
    ).toBeNull();
    await pressWorkspace('Next page');
    await screen.findByText('Other guest 20');
    await pressWorkspace('Previous page');
    await screen.findByText('Rechecked design');
    await fireEvent.changeText(
      screen.getByLabelText('Search by display name'),
      'deny',
    );
    await pressWorkspace('Search');
    await screen.findByRole('button', { name: 'Retry directory' });
    expect(screen.queryByText('Rechecked design')).toBeNull();
    expect(screen.getByText('Guests')).toBeTruthy();
  } finally {
    await env.dispose();
  }
});

test('member actions respect offline state and the rate-limit cooldown', async () => {
  mockPath = `/workspaces/${b.id}/members`;
  const target = memberFixture(1);
  let writes = 0;
  const env = await setup({
    view: 'collaboration',
    first: [collaborationAdmin, a],
    override(url, init) {
      if (url.pathname.endsWith('/members'))
        return envelope(page([target], 1, 20));
      if (init.method !== 'PATCH') return null;
      writes += 1;
      return envelope(
        { success: false, statusCode: 429, message: 'Wait' },
        429,
        '300',
      );
    },
  });
  const button = (name) => screen.getByRole('button', { name });
  try {
    await screen.findByText(target.displayName);
    await act(() => onlineManager.setOnline(false));
    expect(button('Refresh directory')).toBeDisabled();
    expect(button('Actions for Roster member 1')).toBeDisabled();
    expect(screen.getByText(target.displayName)).toBeTruthy();
    await act(() => onlineManager.setOnline(true));
    await waitFor(() =>
      expect(button('Actions for Roster member 1')).toBeEnabled(),
    );
    await pressWorkspace('Actions for Roster member 1');
    await confirmWorkspace('Change role');
    await confirmWorkspace('Change role');
    await within(screen.getByTestId('native-modal')).findByText(
      'Too many requests. Try again shortly.',
    );
    expect(button('Change role')).toBeDisabled();
    await fireEvent.press(button('Change role'));
    expect(writes).toBe(1);
    await pressWorkspace('Cancel');
    expect(button('Actions for Roster member 1')).toBeDisabled();
  } finally {
    await act(() => onlineManager.setOnline(true));
    mockPath = '/boards';
    await env.dispose();
  }
});

test('a late Workspace roster response cannot cross an account switch', async () => {
  mockPath = `/workspaces/${b.id}/members`;
  let completeRoster;
  let signal;
  const roster = new Promise((resolve) => {
    completeRoster = resolve;
  });
  const env = await setup({
    view: 'collaboration',
    override(url, init) {
      if (!url.pathname.endsWith('/members')) return null;
      signal = init.signal;
      return roster;
    },
  });
  try {
    await waitFor(() => expect(signal).toBeDefined());
    await act(() => env.manager.establishSession(loginResponse(USER_B)));
    expect(signal.aborted).toBe(true);
    await act(() => completeRoster(envelope(page([memberFixture(1)], 1, 20))));
    expect(screen.queryByText('Roster member 1')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Actions for Roster member 1' }),
    ).toBeNull();
  } finally {
    mockPath = '/boards';
    await env.dispose();
  }
});

test('an ambiguous role change blocks a repeat until the roster is checked', async () => {
  mockPath = `/workspaces/${b.id}/members`;
  let target = memberFixture(1);
  let writes = 0;
  const env = await setup({
    view: 'collaboration',
    first: [collaborationAdmin, a],
    override(url, init) {
      if (url.pathname.endsWith('/members'))
        return envelope(page([target], 1, 20));
      if (init.method !== 'PATCH') return null;
      writes += 1;
      target = { ...target, role: JSON.parse(init.body).role };
      return fault(503, 'Connection interrupted');
    },
  });
  try {
    await pressWorkspace('Actions for Roster member 1');
    await confirmWorkspace('Change role');
    await confirmWorkspace('Change role');
    await within(screen.getByTestId('native-modal')).findByText(
      /may have reached the server/,
    );
    expect(
      within(screen.getByTestId('native-modal')).getByRole('button', {
        name: 'Change role',
      }),
    ).toBeDisabled();
    await pressWorkspace('Cancel');
    expect(screen.queryByText('Workspace role updated.')).toBeNull();
    await pressWorkspace('Check latest members');
    await screen.findByText('Workspace ADMIN');
    await pressWorkspace('Actions for Roster member 1');
    await confirmWorkspace('Change role');
    await screen.findByText('Change to Workspace MEMBER?');
    expect(writes).toBe(1);
  } finally {
    mockPath = '/boards';
    await env.dispose();
  }
});

test('policy editing sends only changed flags, preserves an error draft and hides writes on downgrade', async () => {
  mockPath = `/workspaces/${b.id}/policies`;
  let actor = collaborationAdmin;
  let policy = { ...policyFixture };
  let conflict = true;
  const patches = [];
  const env = await setup({
    view: 'collaboration',
    override(url, init) {
      if (url.pathname === `/api/workspaces/${b.id}`) return ok(actor);
      if (!url.pathname.endsWith('/policies')) return null;
      if (init.method === 'PATCH') {
        patches.push(JSON.parse(init.body));
        if (conflict) return fault(409, 'Check the latest policy');
        policy = { ...policy, ...patches.at(-1) };
      }
      return ok(policy);
    },
  });
  const label = 'Board owners can add Board members';
  const otherLabel = 'Board owners can change Board membership';
  const refresh = () =>
    act(() =>
      env.data.queryClient.invalidateQueries({
        queryKey: queryKeys.workspace(env.data.getIdentity(), b.id),
      }),
    );
  try {
    await screen.findByLabelText(label);
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    await fireEvent(screen.getByLabelText(otherLabel), 'valueChange', false);
    await fireEvent(screen.getByLabelText(otherLabel), 'valueChange', true);
    await fireEvent(screen.getByLabelText(label), 'valueChange', false);
    policy = { ...policy, boardMembershipChangesEnabled: false };
    await refresh();
    await waitFor(() =>
      expect(screen.getByLabelText(otherLabel).props.value).toBe(false),
    );
    await pressWorkspace('Save policies');
    await screen.findByText('Check the latest policy');
    expect(screen.getByLabelText(label).props.value).toBe(false);
    conflict = false;
    await pressWorkspace('Save policies');
    await screen.findByText('Workspace policies saved.');
    expect(patches).toEqual([
      { boardInvitesEnabled: false },
      { boardInvitesEnabled: false },
    ]);
    actor = b;
    await refresh();
    await screen.findByText('Workspace policies are read-only for your role.');
    expect(screen.queryByRole('button', { name: 'Save policies' })).toBeNull();
  } finally {
    mockPath = '/boards';
    await env.dispose();
  }
});

test('policy polling waits for each Retry-After and stops on unmount', async () => {
  jest.useFakeTimers();
  mockPath = `/workspaces/${b.id}/policies`;
  let requests = 0;
  const env = await setup({
    view: 'collaboration',
    first: [collaborationAdmin],
    override(url) {
      if (!url.pathname.endsWith('/policies')) return null;
      requests++;
      return envelope({}, 429, requests === 1 ? '300' : '120');
    },
  });
  const advance = (ms) => act(() => jest.advanceTimersByTimeAsync(ms));
  const retry = () => screen.getByRole('button', { name: 'Retry policies' });
  try {
    await act(() => focusManager.setFocused(true));
    await screen.findByRole('button', { name: 'Retry policies' });
    expect(requests).toBe(1);
    await advance(30_000);
    expect(requests).toBe(1);
    await advance(269_000);
    expect(retry()).toBeDisabled();
    await advance(1_000);
    expect(retry()).toBeEnabled();
    await advance(30_000);
    expect(requests).toBe(2);
    expect(retry()).toBeDisabled();
    await advance(30_000);
    expect(requests).toBe(2);
    await advance(91_000);
    expect(retry()).toBeEnabled();
    await advance(30_000);
    expect(requests).toBe(3);
    await env.show(null);
    await advance(300_000);
    expect(requests).toBe(3);
  } finally {
    await env.dispose();
    mockPath = '/boards';
    jest.useRealTimers();
  }
});

test('Back can keep or discard a policy draft after a failed refresh', async () => {
  mockPath = `/workspaces/${b.id}/policies`;
  let failed = false;
  const env = await setup({
    view: 'collaboration',
    first: [collaborationAdmin],
    override(url) {
      if (!url.pathname.endsWith('/policies')) return null;
      return failed ? fail(503) : ok(policyFixture);
    },
  });
  const label = 'Board owners can add Board members';
  let navigation;
  const repeat = jest.fn(() => {
    navigation = env.show(null);
  });
  const back = () => act(() => mockPreventRemove({ repeat }));
  try {
    await screen.findByLabelText(label);
    await fireEvent(screen.getByLabelText(label), 'valueChange', false);
    failed = true;
    await act(() =>
      env.data.queryClient.invalidateQueries({
        queryKey: [
          ...queryKeys.workspace(env.data.getIdentity(), b.id),
          'policies',
        ],
      }),
    );
    await screen.findByRole('button', { name: 'Retry policies' });
    await back();
    await confirmWorkspace('Keep editing');
    expect(repeat).not.toHaveBeenCalled();
    failed = false;
    await pressWorkspace('Retry policies');
    expect((await screen.findByLabelText(label)).props.value).toBe(false);
    failed = true;
    await act(() =>
      env.data.queryClient.invalidateQueries({
        queryKey: [
          ...queryKeys.workspace(env.data.getIdentity(), b.id),
          'policies',
        ],
      }),
    );
    await screen.findByRole('button', { name: 'Retry policies' });
    await back();
    await confirmWorkspace('Discard changes');
    expect(repeat).toHaveBeenCalledTimes(1);
    await navigation;
    expect(screen.queryByText('Permissions')).toBeNull();
    expect(screen.queryByTestId('native-modal')).toBeNull();
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});

test('Workspace refresh errors preserve an open role dialog until access is denied', async () => {
  mockPath = `/workspaces/${b.id}/members`;
  let detailStatus = 200;
  const env = await setup({
    view: 'collaboration',
    first: [collaborationAdmin],
    override(url) {
      if (url.pathname.endsWith('/members'))
        return envelope(page([memberFixture(1)], 1, 20));
      if (url.pathname.endsWith(b.id) && detailStatus !== 200)
        return fail(detailStatus);
      return null;
    },
  });
  const refresh = () =>
    act(() =>
      env.data.queryClient.invalidateQueries({
        queryKey: queryKeys.workspace(env.data.getIdentity(), b.id),
        exact: true,
      }),
    );
  try {
    await pressWorkspace('Actions for Roster member 1');
    await confirmWorkspace('Change role');
    detailStatus = 503;
    await refresh();
    await screen.findByRole('button', { name: 'Retry workspace' });
    expect(screen.getByText('Promote to Workspace ADMIN?')).toBeTruthy();
    detailStatus = 200;
    await pressWorkspace('Retry workspace');
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Retry workspace' }),
      ).toBeNull(),
    );
    expect(screen.getByText('Promote to Workspace ADMIN?')).toBeTruthy();
    await act(() => onlineManager.setOnline(false));
    expect(screen.getByText('Promote to Workspace ADMIN?')).toBeTruthy();
    expect(screen.queryByText('Connection unavailable')).toBeNull();
    await act(() => onlineManager.setOnline(true));
    detailStatus = 403;
    await refresh();
    await screen.findByText('Resource unavailable');
    expect(screen.queryByText('Roster member 1')).toBeNull();
    expect(screen.queryByTestId('native-modal')).toBeNull();
  } finally {
    await act(() => onlineManager.setOnline(true));
    await env.dispose();
    mockPath = '/boards';
  }
});

test('a cold offline Workspace section hides cached data until verification succeeds', async () => {
  mockPath = `/workspaces/${b.id}/members`;
  let status = 503;
  const env = await setup({
    view: null,
    first: [collaborationAdmin],
    override(url) {
      if (url.pathname.endsWith('/members'))
        return envelope(page([memberFixture(1)], 1, 20));
      if (url.pathname.endsWith(b.id) && status !== 200) return fail(status);
      return null;
    },
  });
  try {
    const key = queryKeys.workspace(env.data.getIdentity(), b.id);
    env.data.queryClient.setQueryData(key, collaborationAdmin);
    await act(() => onlineManager.setOnline(false));
    await env.show('collaboration');
    await screen.findByText('Connection unavailable');
    expect(screen.queryByText(collaborationAdmin.name)).toBeNull();
    expect(env.fetch).not.toHaveBeenCalled();
    await act(() => onlineManager.setOnline(true));
    await screen.findByRole('button', { name: 'Retry workspace' });
    expect(screen.queryByText(collaborationAdmin.name)).toBeNull();
    status = 200;
    await pressWorkspace('Retry workspace');
    await screen.findByText('Roster member 1');
  } finally {
    await act(() => onlineManager.setOnline(true));
    await env.dispose();
    mockPath = '/boards';
  }
});

test('Board search, status and sort are sent to the server', async () => {
  const env = await setup({
    override: (url) => {
      if (url.pathname !== `/api/workspaces/${a.id}/boards`) return null;
      const rows =
        url.searchParams.get('starred') === 'true'
          ? []
          : url.searchParams.get('search') ||
              url.searchParams.get('status') === 'archived'
            ? []
            : [savedA];
      return envelope(page(rows, Number(url.searchParams.get('page')), 20));
    },
  });
  try {
    await screen.findByText('Personal planning');
    await fireEvent.changeText(
      screen.getByLabelText('Search boards'),
      ' roadmap ',
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Apply board search' }),
    );
    await screen.findByText('No boards match your search');
    await fireEvent.press(screen.getByRole('button', { name: 'Archived' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Sort by name' }));
    await waitFor(() =>
      expect(
        env.fetch.mock.calls.some(([url]) => {
          const query = new URL(url).searchParams;
          return (
            query.get('search') === 'roadmap' &&
            query.get('status') === 'archived' &&
            query.get('sort') === 'name' &&
            query.get('page') === '1'
          );
        }),
      ).toBe(true),
    );
    await switchTo(/Select Design and research/);
    await screen.findByText('Team roadmap');
    await switchTo(/Select Product team/);
    await screen.findByText('No boards match your search');
    expect(screen.getByLabelText('Search boards').props.value).toBe(
      ' roadmap ',
    );
  } finally {
    await env.dispose();
  }
});

test('starring a row sends its own request without navigating', async () => {
  const personalBoard = { ...savedA };
  const starPath = `/api/boards/${personalBoard.id}/star`;
  const env = await setup({
    boards: [personalBoard, savedB],
    override: (url, init) => {
      if (url.pathname !== starPath || init.method !== 'PUT') return null;
      personalBoard.isStarred = true;
      return ok({ isStarred: personalBoard.isStarred, lastViewedAt: null });
    },
  });
  try {
    await screen.findByText('Personal planning');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Star Personal planning' }),
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: 'Unstar Personal planning' }),
      ).toHaveLength(2),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(
      env.fetch.mock.calls
        .filter(
          ([url, init]) =>
            new URL(url).pathname.endsWith('/star') && init.method === 'PUT',
        )
        .map(([url]) => new URL(url).pathname),
    ).toEqual([starPath]);
  } finally {
    await env.dispose();
  }
});

test('starred section queries the selected Workspace without inventing stars', async () => {
  const env = await setup({ boards: [{ ...savedA, isStarred: true }, savedB] });
  try {
    await waitFor(() =>
      expect(screen.getAllByText('Personal planning')).toHaveLength(2),
    );
    const starredCalls = env.fetch.mock.calls
      .map(([url]) => new URL(url))
      .filter(
        (url) =>
          url.pathname.endsWith('/boards') &&
          url.searchParams.get('starred') === 'true',
      );
    expect(starredCalls[0].pathname).toBe(`/api/workspaces/${a.id}/boards`);
    await switchTo(/Select Design and research/);
    await screen.findByText('Team roadmap');
    expect(screen.queryByText('Personal planning')).toBeNull();
    expect(screen.getByText('No starred boards yet')).toBeTruthy();
  } finally {
    await env.dispose();
  }
});

test('two visible copies share one pending star operation', async () => {
  let resolveStar;
  const pending = new Promise((resolve) => {
    resolveStar = resolve;
  });
  const env = await setup({
    boards: [{ ...savedA, isStarred: true }],
    override: (url, init) =>
      url.pathname === `/api/boards/${savedA.id}/star` &&
      init.method === 'DELETE'
        ? pending
        : null,
  });
  try {
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: 'Unstar Personal planning' }),
      ).toHaveLength(2),
    );
    const controls = screen.getAllByRole('button', {
      name: 'Unstar Personal planning',
    });
    await fireEvent.press(controls[0]);
    expect(controls[1]).toBeDisabled();
    await fireEvent.press(controls[1]);
    expect(
      env.fetch.mock.calls.filter(
        ([url, init]) =>
          new URL(url).pathname.endsWith('/star') && init.method === 'DELETE',
      ),
    ).toHaveLength(1);
    await act(() => resolveStar(ok({ isStarred: false, lastViewedAt: null })));
  } finally {
    resolveStar(ok({ isStarred: false, lastViewedAt: null }));
    await env.dispose();
  }
});

test('Board-only guest access appears separately without inventing a Workspace', async () => {
  const guest = {
    ...board(c.id, 99),
    name: 'Guest board',
    visibility: 'PRIVATE',
    currentUserRole: 'MEMBER',
    createdById: c.id,
  };
  const env = await setup({
    override: (url, init) =>
      url.pathname === '/api/boards' && init.method === 'GET'
        ? envelope(page([guest], Number(url.searchParams.get('page')), 20))
        : null,
  });
  try {
    await screen.findByRole('button', {
      name: 'Open shared board Guest board',
    });
    await fireEvent.press(await trigger());
    expect(
      screen.queryByRole('button', { name: /Select Workspace 3/ }),
    ).toBeNull();
  } finally {
    await env.dispose();
  }
});

test('a removed Workspace cannot expose an old Board as a guest during recheck', async () => {
  const oldBoard = {
    ...board(b.id, 85),
    name: 'Former private board',
    visibility: 'PRIVATE',
    currentUserRole: 'MEMBER',
    createdById: b.id,
  };
  let removed = false;
  let resolveRecheck;
  const recheck = new Promise((resolve) => {
    resolveRecheck = resolve;
  });
  const env = await setup({
    first: [a, b],
    override: (url, init) => {
      if (url.pathname === '/api/workspaces' && removed)
        return envelope(page([a], Number(url.searchParams.get('page')), 20));
      if (url.pathname === '/api/boards' && init.method === 'GET')
        return removed
          ? recheck
          : envelope(
              page([oldBoard], Number(url.searchParams.get('page')), 20),
            );
      return null;
    },
  });
  try {
    await screen.findByText('Personal planning');
    await screen.findByText('No shared boards.');
    expect(screen.queryByText('Former private board')).toBeNull();
    removed = true;
    await act(async () => {
      const refreshing = fireEvent(
        screen.getByTestId('workspace-refresh'),
        'touchEnd',
      );
      await waitFor(() =>
        expect(
          env.fetch.mock.calls.filter(
            ([url]) => new URL(url).pathname === '/api/boards',
          ).length,
        ).toBeGreaterThan(1),
      );
      expect(screen.queryByText('Former private board')).toBeNull();
      resolveRecheck(envelope(page([], 1, 20)));
      await refreshing;
    });
    await screen.findByText('No shared boards.');
    expect(screen.queryByText('Former private board')).toBeNull();
  } finally {
    await env.dispose();
  }
});

test('creates a private Board in an authorized Workspace once', async () => {
  const permitted = { ...a, canCreateBoards: true };
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const env = await setup({
    first: [permitted],
    override: (url, init) => {
      if (url.pathname === '/api/boards/background-presets')
        return ok([
          { id: 'blue', kind: 'color', value: '#2563EB', foreground: 'light' },
        ]);
      if (url.pathname === '/api/boards' && init.method === 'POST')
        return pending;
      return null;
    },
  });
  try {
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Create board' }),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Board name'),
      '  New board  ',
    );
    const create = screen
      .getAllByRole('button', { name: 'Create board' })
      .at(-1);
    await fireEvent.press(create);
    await fireEvent.press(create);
    await waitFor(() =>
      expect(
        env.fetch.mock.calls.filter(([, init]) => init.method === 'POST'),
      ).toHaveLength(1),
    );
    const call = env.fetch.mock.calls.find(
      ([, init]) => init.method === 'POST',
    );
    expect(JSON.parse(call[1].body)).toEqual({
      name: 'New board',
      workspaceId: a.id,
      description: null,
    });
    await act(() =>
      finish({
        ...envelope(
          {
            success: true,
            statusCode: 201,
            message: 'Created',
            data: {
              ...board(a.id, 11),
              currentUserRole: 'OWNER',
              visibility: 'PRIVATE',
              createdById: a.id,
            },
          },
          201,
        ),
        ok: true,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText('Board name')).toBeNull(),
    );
  } finally {
    await env.dispose();
  }
});

test('uncertain Board creation keeps the draft and blocks a duplicate', async () => {
  const env = await setup({
    first: [{ ...a, canCreateBoards: true }],
    override: (url, init) =>
      url.pathname === '/api/boards' && init.method === 'POST'
        ? fail(503)
        : url.pathname === '/api/boards/background-presets'
          ? ok([])
          : null,
  });
  try {
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Create board' }),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Board name'),
      'Draft board',
    );
    await fireEvent.press(
      screen.getAllByRole('button', { name: 'Create board' }).at(-1),
    );
    await screen.findByText(/previous result is uncertain/i);
    expect(screen.getByLabelText('Board name').props.value).toBe('Draft board');
    expect(
      screen.getAllByRole('button', { name: 'Create board' }).at(-1),
    ).toBeDisabled();
    expect(
      env.fetch.mock.calls.filter(([, init]) => init.method === 'POST'),
    ).toHaveLength(1);
  } finally {
    await env.dispose();
  }
});

test('going offline disables Board creation without losing the draft', async () => {
  const env = await setup({
    first: [{ ...a, canCreateBoards: true }],
    override: (url) =>
      url.pathname === '/api/boards/background-presets' ? ok([]) : null,
  });
  try {
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Create board' }),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Board name'),
      'Offline draft',
    );
    await act(() => onlineManager.setOnline(false));
    expect(
      screen.getAllByRole('button', { name: 'Create board' }).at(-1),
    ).toBeDisabled();
    expect(screen.getByLabelText('Board name').props.value).toBe(
      'Offline draft',
    );
    expect(
      env.fetch.mock.calls.some(([, init]) => init.method === 'POST'),
    ).toBe(false);
  } finally {
    await act(() => onlineManager.setOnline(true));
    await env.dispose();
  }
});

test('only an explicit active Board owner can open the editor and save metadata', async () => {
  const owner = {
    ...savedA,
    currentUserRole: 'OWNER',
    capabilities: {
      ...savedA.capabilities,
      canManageBoard: true,
      canWriteBoard: true,
    },
    createdById: a.id,
  };
  const env = await setup({
    boards: [owner, savedB],
    override: (url) =>
      url.pathname === `/api/boards/${owner.id}` ? ok(owner) : null,
  });
  try {
    await openBoardEditor('Personal planning');
    await screen.findByLabelText('Board name');
    await fireEvent.changeText(screen.getByLabelText('Board name'), 'Renamed');
    await fireEvent.press(screen.getByRole('button', { name: 'Save board' }));
    await waitFor(() =>
      expect(
        env.fetch.mock.calls.some(([, init]) => init.method === 'PATCH'),
      ).toBe(true),
    );
    expect(
      JSON.parse(
        env.fetch.mock.calls.find(([, init]) => init.method === 'PATCH')[1]
          .body,
      ),
    ).toEqual({ name: 'Renamed' });
  } finally {
    await env.dispose();
  }
});

test('a downgraded Board role is rechecked before showing the editor', async () => {
  const listed = {
    ...savedA,
    currentUserRole: 'OWNER',
    capabilities: { ...savedA.capabilities, canManageBoard: true },
  };
  const env = await setup({
    boards: [listed],
    override: (url) =>
      url.pathname === `/api/boards/${listed.id}`
        ? ok({
            ...listed,
            currentUserRole: 'MEMBER',
            createdById: a.id,
            capabilities: { ...listed.capabilities, canManageBoard: false },
          })
        : null,
  });
  try {
    await openBoardEditor('Personal planning');
    await screen.findByText('Board editing is unavailable.');
    expect(screen.queryByLabelText('Board name')).toBeNull();
    expect(
      env.fetch.mock.calls.some(([, init]) => init.method === 'PATCH'),
    ).toBe(false);
  } finally {
    await env.dispose();
  }
});

test('background conflict refreshes the version before an explicit retry', async () => {
  const owner = {
    ...savedA,
    currentUserRole: 'OWNER',
    createdById: a.id,
    capabilities: {
      ...savedA.capabilities,
      canManageBoard: true,
      canWriteBoard: true,
    },
  };
  let latest = owner;
  let writes = 0;
  const env = await setup({
    boards: [owner],
    override: (url) => {
      if (url.pathname === '/api/boards/background-presets')
        return ok([
          { id: 'blue', kind: 'color', value: '#2563EB', foreground: 'light' },
        ]);
      if (url.pathname === `/api/boards/${owner.id}`) return ok(latest);
      if (url.pathname === `/api/boards/${owner.id}/background`) {
        writes++;
        if (writes === 1) {
          latest = { ...owner, backgroundVersion: 2 };
          return envelope(
            {
              success: false,
              statusCode: 409,
              code: 'BACKGROUND_CONFLICT',
              message: 'Changed',
            },
            409,
          );
        }
        return ok({
          ...latest,
          backgroundPreset: 'blue',
          backgroundVersion: 3,
        });
      }
      return null;
    },
  });
  try {
    await openBoardEditor('Personal planning');
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Background blue' }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Apply background' }),
    );
    await screen.findByText(
      'The background changed elsewhere. Review it and apply your choice again.',
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Apply background' }),
    );
    await waitFor(() => expect(writes).toBe(2));
    const calls = env.fetch.mock.calls.filter(([url]) =>
      new URL(url).pathname.endsWith('/background'),
    );
    expect(
      calls.map(([, init]) => JSON.parse(init.body).expectedVersion),
    ).toEqual([1, 2]);
  } finally {
    await env.dispose();
  }
});

test('saving metadata preserves a pending background selection', async () => {
  const owner = {
    ...savedA,
    currentUserRole: 'OWNER',
    createdById: a.id,
    capabilities: {
      ...savedA.capabilities,
      canManageBoard: true,
      canWriteBoard: true,
    },
  };
  const env = await setup({
    boards: [owner],
    override: (url, init) => {
      if (url.pathname === '/api/boards/background-presets')
        return ok([
          { id: 'blue', kind: 'color', value: '#2563EB', foreground: 'light' },
        ]);
      if (url.pathname === `/api/boards/${owner.id}`)
        return ok(
          init.method === 'PATCH' ? { ...owner, name: 'Renamed' } : owner,
        );
      return null;
    },
  });
  try {
    await openBoardEditor('Personal planning');
    await fireEvent.changeText(
      await screen.findByLabelText('Board name'),
      'Renamed',
    );
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Background blue' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Save board' }));
    await screen.findByText(
      'Board details saved. Apply or discard the background choice.',
    );
    expect(
      screen.getByRole('button', { name: 'Background blue' }).props
        .accessibilityState.selected,
    ).toBe(true);
  } finally {
    await env.dispose();
  }
});

test('Personal first, selected outline semantics, Android modal close, tab return and new account reset', async () => {
  const env = await setup();
  try {
    await screen.findByText('Personal planning');
    await fireEvent.press(await trigger());
    expect(
      screen.getByRole('header', { name: 'Switch workspace' }),
    ).toBeTruthy();
    const choices = screen.getAllByRole('button', { name: /^Select / });
    expect(choices[0].props.accessibilityState.selected).toBe(true);
    expect(choices[1].props.accessibilityLabel).toMatch(/Design and research/);
    await fireEvent(screen.getByTestId('native-modal'), 'touchEnd');
    expect(
      screen.queryByRole('header', { name: 'Switch workspace' }),
    ).toBeNull();
    await switchTo(/Select Design and research/);
    await screen.findByText('Team roadmap');
    expect(screen.queryByText('Personal planning')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Open board Team roadmap' }),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Open board Team roadmap' }),
    );
    expect(mockNavigate).toHaveBeenLastCalledWith('/boards/' + savedB.id);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Workspace overview' }),
    );
    expect(mockNavigate).toHaveBeenLastCalledWith('/workspaces/' + b.id);
    await env.show(null);
    await env.show('boards');
    await screen.findByText('Team roadmap');
    expect(
      env.fetch.mock.calls.filter(([url]) => String(url).endsWith('/overview')),
    ).toHaveLength(2);
    expect(
      screen.queryByText(/Create board|Manage workspaces|Create new workspace/),
    ).toBeNull();
    await act(() => env.manager.establishSession(loginResponse(USER_B)));
    expect(screen.queryByText('Team roadmap')).toBeNull();
    await screen.findByText('No boards in this workspace');
    expect((await trigger()).props.accessibilityLabel).toMatch(/Workspace 3/);
    await act(() => env.manager.logout());
    expect(
      screen.queryByRole('button', { name: /^Switch workspace/ }),
    ).toBeNull();
  } finally {
    await env.dispose();
  }
});

test('large directory is fully selectable and Board pagination remains explicit', async () => {
  const more = Array.from({ length: 121 }, (_, index) => workspace(index + 10));
  const boards = Array.from({ length: 21 }, (_, index) =>
    board(a.id, index + 1),
  );
  const env = await setup({ first: [a, ...more], boards });
  try {
    await screen.findByText('Board 1');
    expect(screen.queryByText('Board 21')).toBeNull();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Load more boards' }),
    );
    await screen.findByText('Board 21');
    await fireEvent.press(await trigger());
    expect(screen.getAllByRole('button', { name: /^Select / })).toHaveLength(
      122,
    );
    expect(
      env.fetch.mock.calls.filter(
        ([url]) => new URL(url).pathname === '/api/workspaces',
      ),
    ).toHaveLength(7);
    expect(
      env.fetch.mock.calls.filter(([url]) => String(url).endsWith('/overview')),
    ).toHaveLength(1);
  } finally {
    await env.dispose();
  }
});

test('Board paging keeps at most five pages and can return to earlier results', async () => {
  const boards = Array.from({ length: 101 }, (_, index) =>
    board(a.id, index + 1),
  );
  const env = await setup({ first: [a], boards });
  try {
    await screen.findByText('Board 1');
    for (const last of [21, 41, 61, 81, 101]) {
      await fireEvent.press(
        screen.getByRole('button', { name: 'Load more boards' }),
      );
      await screen.findByText(`Board ${last}`);
    }
    expect(screen.queryByText('Board 1')).toBeNull();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Load previous boards' }),
    );
    await screen.findByText('Board 1');
    expect(screen.queryByText('Board 101')).toBeNull();
  } finally {
    await env.dispose();
  }
});

test('directory does not fetch user-state or record views for every row', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => board(a.id, index + 1));
  const env = await setup({ first: [a], boards: rows });
  try {
    await screen.findByText('Board 20');
    const paths = env.fetch.mock.calls.map(([url]) => new URL(url).pathname);
    expect(
      paths.some(
        (path) => path.endsWith('/user-state') || path.endsWith('/views'),
      ),
    ).toBe(false);
    expect(
      paths.filter((path) => path === `/api/workspaces/${a.id}/boards`),
    ).toHaveLength(2);
  } finally {
    await env.dispose();
  }
});

test('pull refresh surfaces recoverable directory errors and retains only verified same-session data', async () => {
  let now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  let error = 0;
  const env = await setup({
    override: (url) =>
      url.pathname === '/api/workspaces' && error ? fail(error) : null,
  });
  try {
    await screen.findByText('Personal planning');
    for (const status of [429, 503]) {
      now += 1_000;
      error = status;
      await fireEvent(screen.getByTestId('workspace-refresh'), 'touchEnd');
      await screen.findByText(
        status === 429
          ? 'Too many requests. Try again shortly.'
          : 'Couldn’t load the latest data. Try again.',
      );
      expect(screen.getByText('Personal planning')).toBeTruthy();
      error = 0;
      await fireEvent.press(
        screen.getByRole('button', { name: 'Retry workspaces' }),
      );
      await waitFor(() =>
        expect(screen.queryByText('Workspaces unavailable')).toBeNull(),
      );
    }
    await act(() => onlineManager.setOnline(false));
    expect(
      screen.getByText('Offline. Showing available workspace data.'),
    ).toBeTruthy();
    await act(() => onlineManager.setOnline(true));
  } finally {
    await env.dispose();
    clock.mockRestore();
  }
});

test('deep Workspace screen verifies detail before fetching overview and denies a non-member', async () => {
  mockPath = '/workspaces/' + b.id;
  const env = await setup({ view: 'overview' });
  try {
    await screen.findByText('1 visible boards');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Open board Board 1' }),
    );
    expect(mockNavigate).toHaveBeenLastCalledWith('/boards/' + board(b.id).id);
    const urls = env.fetch.mock.calls.map(([url]) => new URL(url).pathname);
    expect(urls).toEqual([
      '/api/workspaces/' + b.id,
      '/api/workspaces/' + b.id + '/overview',
    ]);
    await env.show(null);
    mockPath = '/workspaces/' + c.id;
    await env.show('overview');
    await screen.findByText('Resource unavailable');
    expect(screen.queryByText('1 visible boards')).toBeNull();
    expect(
      env.fetch.mock.calls.filter(([url]) => String(url).includes(c.id)),
    ).toHaveLength(1);
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});

test('Workspace overview announces archived recent boards as read only', async () => {
  mockPath = '/workspaces/' + b.id;
  const env = await setup({
    view: 'overview',
    override: (url) =>
      url.pathname === `/api/workspaces/${b.id}/overview`
        ? ok({
            ...overview(b),
            activeBoardCount: 0,
            archivedBoardCount: 1,
            recentBoards: [
              {
                ...board(b.id),
                isArchived: true,
                archivedAt: '2026-11-13T09:00:00.000Z',
              },
            ],
          })
        : null,
  });
  try {
    expect(
      await screen.findByRole('button', {
        name: 'Open board Board 1, archived, read only',
      }),
    ).toBeTruthy();
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});

test('Workspace overview renders the server-provided icon accessibly', async () => {
  const withIcon = { ...b, icon: 'code' };
  mockPath = '/workspaces/' + withIcon.id;
  const env = await setup({ first: [withIcon], view: 'overview' });
  try {
    expect(await screen.findByLabelText('Workspace icon: code')).toBeTruthy();
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});

test('reopening Overview refreshes Board counts inside the cache stale window', async () => {
  const admin = { ...b, role: 'ADMIN', canManage: true };
  mockPath = '/workspaces/' + admin.id;
  let archived = false;
  const env = await setup({
    first: [admin],
    view: 'overview',
    override: (url) =>
      url.pathname === '/api/workspaces/' + admin.id + '/overview'
        ? ok({
            ...overview(admin),
            activeBoardCount: archived ? 0 : 1,
            archivedBoardCount: archived ? 1 : 0,
            recentBoards: [],
          })
        : null,
  });
  try {
    await screen.findByText('1 active · 0 archived');
    await env.show(null);
    archived = true;
    await env.show('overview');
    await screen.findByText('0 active · 1 archived');
    expect(
      env.fetch.mock.calls.filter(([url]) =>
        new URL(url).pathname.endsWith('/overview'),
      ),
    ).toHaveLength(2);
  } finally {
    mockPath = '/boards';
    await env.dispose();
  }
});

test('refocusing a mounted Overview refreshes Board counts', async () => {
  const admin = { ...b, role: 'ADMIN', canManage: true };
  mockPath = '/workspaces/' + admin.id;
  let archived = false;
  const env = await setup({
    first: [admin],
    view: 'overview',
    override: (url) =>
      url.pathname === '/api/workspaces/' + admin.id + '/overview'
        ? ok({
            ...overview(admin),
            activeBoardCount: archived ? 0 : 1,
            archivedBoardCount: archived ? 1 : 0,
            recentBoards: [],
          })
        : null,
  });
  try {
    await screen.findByText('1 active · 0 archived');
    mockFocused = false;
    await env.show('overview');
    archived = true;
    mockFocused = true;
    await env.show('overview');
    await screen.findByText('0 active · 1 archived');
    expect(
      env.fetch.mock.calls.filter(([url]) =>
        new URL(url).pathname.endsWith('/overview'),
      ),
    ).toHaveLength(2);
  } finally {
    mockFocused = true;
    mockPath = '/boards';
    await env.dispose();
  }
});

test('creates a Team Workspace once and selects its verified directory entry', async () => {
  const rows = [a];
  const created = {
    ...workspace(8),
    name: 'New team',
    role: 'ADMIN',
    canManage: true,
  };
  const env = await setup({
    first: rows,
    override: (url, init) => {
      if (url.pathname === '/api/workspaces' && init.method === 'POST') {
        rows.push(created);
        return {
          ...envelope(
            {
              success: true,
              statusCode: 201,
              message: 'Created',
              data: created,
            },
            201,
          ),
          ok: true,
        };
      }
      return null;
    },
  });
  try {
    await fireEvent.press(await trigger());
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create new workspace' }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create workspace' }),
    );
    expect(screen.getByText(/Enter a name/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Name'), ' New team ');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create workspace' }),
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/workspaces/' + created.id),
    );
    expect(
      env.fetch.mock.calls.filter(([, init]) => init.method === 'POST'),
    ).toHaveLength(1);
    expect((await trigger()).props.accessibilityLabel).toMatch(/New team/);
  } finally {
    await env.dispose();
  }
});

test('the empty directory offers creation and selects the verified result', async () => {
  const rows = [a];
  const created = {
    ...workspace(8),
    name: 'New team',
    role: 'ADMIN',
    canManage: true,
  };
  const env = await setup({
    first: rows,
    override: (url, init) => {
      if (url.pathname === '/api/workspaces' && init.method === 'POST') {
        rows.push(created);
        return {
          ...envelope(
            {
              success: true,
              statusCode: 201,
              message: 'Created',
              data: created,
            },
            201,
          ),
          ok: true,
        };
      }
      return null;
    },
  });
  try {
    await screen.findByText('Personal planning');
    rows.splice(0);
    await act(() =>
      env.data.queryClient.setQueryData(
        [
          'mobile',
          'private',
          USER_A,
          env.manager.getSnapshot().generation,
          'workspace-lists',
          { limit: 20 },
        ],
        [],
      ),
    );
    await screen.findByText('No workspaces available');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create new workspace' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Name'), 'New team');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create workspace' }),
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/workspaces/' + created.id),
    );
    expect((await trigger()).props.accessibilityLabel).toMatch(/New team/);
  } finally {
    await env.dispose();
  }
});

test('Android back guards a Workspace creation draft', async () => {
  const env = await setup();
  try {
    await fireEvent.press(await trigger());
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create new workspace' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Draft');
    await fireEvent(screen.getByTestId('native-modal'), 'touchEnd');
    expect(screen.getByText('Discard changes?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Name').props.value).toBe('Draft');
  } finally {
    await env.dispose();
  }
});

test('rate-limited creation preserves the draft and waits for Retry-After', async () => {
  const env = await setup({
    override: (url, init) =>
      url.pathname === '/api/workspaces' && init.method === 'POST'
        ? envelope({}, 429, '3')
        : null,
  });
  try {
    await fireEvent.press(await trigger());
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create new workspace' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Draft team');
    jest.useFakeTimers();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create workspace' }),
    );
    await screen.findByText('Too many requests. Try again shortly.');
    expect(screen.getByLabelText('Name').props.value).toBe('Draft team');
    expect(
      screen.getByRole('button', { name: 'Create workspace' }),
    ).toBeDisabled();
    await act(() => jest.advanceTimersByTime(3000));
    expect(
      screen.getByRole('button', { name: 'Create workspace' }),
    ).toBeEnabled();
  } finally {
    jest.useRealTimers();
    await env.dispose();
  }
});

test('an uncertain creation result blocks duplicate requests and retains the draft', async () => {
  const env = await setup({
    override: (url, init) =>
      url.pathname === '/api/workspaces' && init.method === 'POST'
        ? envelope({}, 503)
        : null,
  });
  try {
    await fireEvent.press(await trigger());
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create new workspace' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Uncertain team');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create workspace' }),
    );
    await screen.findByText(/result could not be confirmed/);
    expect(screen.getByLabelText('Name').props.value).toBe('Uncertain team');
    expect(
      screen.getByRole('button', { name: 'Create workspace' }),
    ).toBeDisabled();
    expect(
      env.fetch.mock.calls.filter(([, init]) => init.method === 'POST'),
    ).toHaveLength(1);
    await fireEvent.press(
      screen.getByRole('button', { name: "I've checked the workspace list" }),
    );
    expect(
      screen.getByText(/trying again could create a duplicate/i),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: "I've checked, allow retry" }),
    );
    expect(
      screen.getByRole('button', { name: 'Create workspace' }),
    ).toBeEnabled();
  } finally {
    await env.dispose();
  }
});

test('an uncertain creation remains fenced after the Boards screen remounts', async () => {
  const env = await setup({
    override: (url, init) =>
      url.pathname === '/api/workspaces' && init.method === 'POST'
        ? envelope({}, 503)
        : null,
  });
  try {
    await fireEvent.press(await trigger());
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create new workspace' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Uncertain team');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create workspace' }),
    );
    await screen.findByText(/result could not be confirmed/);
    await env.show(null);
    await env.show('boards');
    await fireEvent.press(await trigger());
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create new workspace' }),
    );
    expect(
      screen.getByRole('button', { name: 'Create workspace' }),
    ).toBeDisabled();
    expect(
      env.fetch.mock.calls.filter(([, init]) => init.method === 'POST'),
    ).toHaveLength(1);
  } finally {
    await env.dispose();
  }
});

test('an uncertain creation fence does not carry into another account', async () => {
  const env = await setup({
    override: (url, init) =>
      url.pathname === '/api/workspaces' && init.method === 'POST'
        ? envelope({}, 503)
        : null,
  });
  try {
    await fireEvent.press(await trigger());
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create new workspace' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Uncertain team');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create workspace' }),
    );
    await screen.findByText(/result could not be confirmed/);
    await act(() => env.manager.establishSession(loginResponse(USER_B)));
    await fireEvent.press(await trigger());
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create new workspace' }),
    );
    expect(
      screen.getByRole('button', { name: 'Create workspace' }),
    ).toBeEnabled();
  } finally {
    await env.dispose();
  }
});

test('rapid creation presses send one request while the first is pending', async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const env = await setup({
    override: (url, init) =>
      url.pathname === '/api/workspaces' && init.method === 'POST'
        ? pending
        : null,
  });
  try {
    await fireEvent.press(await trigger());
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create new workspace' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Name'), 'One team');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create workspace' }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create workspace' }),
    );
    expect(
      env.fetch.mock.calls.filter(([, init]) => init.method === 'POST'),
    ).toHaveLength(1);
    await act(() => finish(envelope({}, 409)));
    await screen.findByText('The request failed.');
  } finally {
    await env.dispose();
  }
});

test('creation cancels an older directory read before selecting the new Workspace', async () => {
  const rows = [a];
  const created = {
    ...workspace(8),
    name: 'New team',
    role: 'ADMIN',
    canManage: true,
  };
  let finishOld;
  const oldRead = new Promise((resolve) => {
    finishOld = resolve;
  });
  let holdNext = false;
  let held = false;
  const env = await setup({
    first: rows,
    override: (url, init) => {
      if (url.pathname !== '/api/workspaces') return null;
      if (init.method === 'POST') {
        rows.push(created);
        return {
          ...envelope(
            {
              success: true,
              statusCode: 201,
              message: 'Created',
              data: created,
            },
            201,
          ),
          ok: true,
        };
      }
      if (holdNext && !held) {
        held = true;
        return oldRead;
      }
      return null;
    },
  });
  try {
    await screen.findByText('Personal planning');
    holdNext = true;
    await fireEvent(screen.getByTestId('workspace-refresh'), 'touchEnd');
    await waitFor(() => expect(held).toBe(true));
    await fireEvent.press(await trigger());
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create new workspace' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Name'), 'New team');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create workspace' }),
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/workspaces/' + created.id),
    );
    await act(() => finishOld(envelope(page([a], 1, 20))));
    expect((await trigger()).props.accessibilityLabel).toMatch(/New team/);
  } finally {
    await env.dispose();
  }
});

test('a create response after leaving Boards does not change the selected Workspace', async () => {
  const rows = [a];
  const created = {
    ...workspace(8),
    name: 'Late team',
    role: 'ADMIN',
    canManage: true,
  };
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const env = await setup({
    first: rows,
    override: (url, init) =>
      url.pathname === '/api/workspaces' && init.method === 'POST'
        ? pending
        : null,
  });
  try {
    await fireEvent.press(await trigger());
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create new workspace' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Late team');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create workspace' }),
    );
    mockFocused = false;
    await env.show('boards');
    rows.push(created);
    await act(() =>
      finish({
        ...envelope(
          { success: true, statusCode: 201, message: 'Created', data: created },
          201,
        ),
        ok: true,
      }),
    );
    await screen.findByText(/The result could not be confirmed/);
    expect(mockNavigate).not.toHaveBeenCalledWith('/workspaces/' + created.id);
    mockFocused = true;
    await env.show('boards');
    expect((await trigger()).props.accessibilityLabel).not.toMatch(/Late team/);
    expect(
      env.fetch.mock.calls.filter(([, init]) => init.method === 'POST'),
    ).toHaveLength(1);
  } finally {
    mockFocused = true;
    await env.dispose();
  }
});

test('a create response after Boards unmounts does not navigate or select', async () => {
  const rows = [a];
  const created = {
    ...workspace(8),
    name: 'Unmounted team',
    role: 'ADMIN',
    canManage: true,
  };
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const env = await setup({
    first: rows,
    override: (url, init) =>
      url.pathname === '/api/workspaces' && init.method === 'POST'
        ? pending
        : null,
  });
  try {
    await fireEvent.press(await trigger());
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create new workspace' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Unmounted team');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create workspace' }),
    );
    await env.show(null);
    const directoryReads = () =>
      env.fetch.mock.calls.filter(
        ([url, init]) =>
          new URL(url).pathname === '/api/workspaces' && init.method === 'GET',
      ).length;
    const beforeResponse = directoryReads();
    rows.push(created);
    await act(() =>
      finish({
        ...envelope(
          { success: true, statusCode: 201, message: 'Created', data: created },
          201,
        ),
        ok: true,
      }),
    );
    await waitFor(() =>
      expect(directoryReads()).toBeGreaterThan(beforeResponse),
    );
    expect(mockNavigate).not.toHaveBeenCalledWith('/workspaces/' + created.id);
    await env.show('boards');
    expect((await trigger()).props.accessibilityLabel).not.toMatch(
      /Unmounted team/,
    );
  } finally {
    await env.dispose();
  }
});

test('a committed creation retries directory lookup without posting twice', async () => {
  const rows = [a];
  const created = {
    ...workspace(8),
    name: 'New team',
    role: 'ADMIN',
    canManage: true,
  };
  let failLookup = false;
  const env = await setup({
    first: rows,
    override: (url, init) => {
      if (url.pathname !== '/api/workspaces') return null;
      if (init.method === 'POST') {
        rows.push(created);
        failLookup = true;
        return {
          ...envelope(
            {
              success: true,
              statusCode: 201,
              message: 'Created',
              data: created,
            },
            201,
          ),
          ok: true,
        };
      }
      if (failLookup) {
        failLookup = false;
        return fail(503);
      }
      return null;
    },
  });
  try {
    await fireEvent.press(await trigger());
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create new workspace' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Name'), 'New team');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create workspace' }),
    );
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Retry workspace lookup' }),
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/workspaces/' + created.id),
    );
    expect(
      env.fetch.mock.calls.filter(([, init]) => init.method === 'POST'),
    ).toHaveLength(1);
  } finally {
    await env.dispose();
  }
});

test('admin edits nullable metadata and an eligible Team deletion requires the exact name', async () => {
  const admin = {
    ...b,
    role: 'ADMIN',
    canManage: true,
    description: 'Old description',
  };
  mockPath = '/workspaces/' + admin.id;
  const env = await setup({
    first: [a, admin],
    view: 'overview',
    override: (url, init) => {
      if (url.pathname === '/api/workspaces/' + admin.id + '/overview')
        return ok({
          ...overview(admin),
          visibleBoardCount: 0,
          activeBoardCount: 0,
          recentBoards: [],
        });
      if (
        url.pathname === '/api/workspaces/' + admin.id &&
        init.method === 'PATCH'
      )
        return ok({ ...admin, description: null });
      if (
        url.pathname === '/api/workspaces/' + admin.id &&
        init.method === 'DELETE'
      )
        return { status: 204, ok: true, headers: { get: () => null } };
      return null;
    },
  });
  try {
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Edit workspace' }),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Description (optional)'),
      '',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        env.fetch.mock.calls.some(([, init]) => init.method === 'PATCH'),
      ).toBe(true),
    );
    const patch = env.fetch.mock.calls.find(
      ([, init]) => init.method === 'PATCH',
    )[1];
    expect(JSON.parse(patch.body)).toEqual({ description: null });
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Delete workspace' }),
    );
    expect(
      screen.getByRole('button', { name: 'Delete workspace', disabled: true }),
    ).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Workspace name'),
      admin.name,
    );
    const buttons = screen.getAllByRole('button', { name: 'Delete workspace' });
    await fireEvent.press(buttons[buttons.length - 1]);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/boards'));
    const deletion = env.fetch.mock.calls.find(
      ([, init]) => init.method === 'DELETE',
    )[1];
    expect(JSON.parse(deletion.body)).toEqual({ confirmationName: admin.name });
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});

test('last admin cannot leave and the workspace remains visible after a 409', async () => {
  const admin = { ...b, role: 'ADMIN', canManage: true };
  mockPath = '/workspaces/' + admin.id;
  const env = await setup({
    first: [a, admin],
    view: 'overview',
    override: (url, init) => {
      if (
        url.pathname === '/api/workspaces/' + admin.id + '/leave' &&
        init.method === 'POST'
      )
        return envelope(
          {
            success: false,
            statusCode: 409,
            code: 'CONFLICT',
            message: 'The last admin cannot leave',
          },
          409,
        );
      return null;
    },
  });
  try {
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Leave workspace' }),
    );
    const buttons = screen.getAllByRole('button', { name: 'Leave workspace' });
    await fireEvent.press(buttons[buttons.length - 1]);
    await screen.findByText('The last admin cannot leave');
    expect(screen.getByText(/Design and research/)).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalledWith('/boards');
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});

test('a hidden Board blocker returns 409 without deleting the Workspace', async () => {
  const admin = { ...b, role: 'ADMIN', canManage: true };
  mockPath = '/workspaces/' + admin.id;
  const env = await setup({
    first: [admin],
    view: 'overview',
    override: (url, init) => {
      if (url.pathname === '/api/workspaces/' + admin.id + '/overview')
        return ok({
          ...overview(admin),
          visibleBoardCount: 0,
          activeBoardCount: 0,
          recentBoards: [],
        });
      if (
        url.pathname === '/api/workspaces/' + admin.id &&
        init.method === 'DELETE'
      )
        return envelope(
          {
            success: false,
            statusCode: 409,
            code: 'CONFLICT',
            message: 'Workspace must be empty before deletion',
          },
          409,
        );
      return null;
    },
  });
  try {
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Delete workspace' }),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Workspace name'),
      admin.name,
    );
    const buttons = screen.getAllByRole('button', { name: 'Delete workspace' });
    await fireEvent.press(buttons[buttons.length - 1]);
    await screen.findByText('Workspace must be empty before deletion');
    expect(mockNavigate).not.toHaveBeenCalledWith('/boards');
    expect(screen.getByText(/Design and research/)).toBeTruthy();
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});

test.each(['active', 'archived'])(
  'an admin cannot delete a Team with a visible %s Board',
  async (status) => {
    const admin = { ...b, role: 'ADMIN', canManage: true };
    mockPath = '/workspaces/' + admin.id;
    const env = await setup({
      first: [admin],
      view: 'overview',
      override: (url) =>
        url.pathname === '/api/workspaces/' + admin.id + '/overview'
          ? ok({
              ...overview(admin),
              activeBoardCount: status === 'active' ? 1 : 0,
              archivedBoardCount: status === 'archived' ? 1 : 0,
              recentBoards: [],
            })
          : null,
    });
    try {
      await screen.findByText(/must have no boards before it can be deleted/i);
      expect(
        screen.queryByRole('button', { name: 'Delete workspace' }),
      ).toBeNull();
      expect(
        env.fetch.mock.calls.some(([, init]) => init.method === 'DELETE'),
      ).toBe(false);
    } finally {
      await env.dispose();
      mockPath = '/boards';
    }
  },
);

test('successful Team leave returns to Boards and removes Workspace access', async () => {
  mockPath = '/workspaces/' + b.id;
  const env = await setup({
    first: [a, b],
    view: 'overview',
    override: (url, init) =>
      url.pathname === '/api/workspaces/' + b.id + '/leave' &&
      init.method === 'POST'
        ? { status: 204, ok: true, headers: { get: () => null } }
        : null,
  });
  try {
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Leave workspace' }),
    );
    const buttons = screen.getAllByRole('button', { name: 'Leave workspace' });
    await fireEvent.press(buttons[buttons.length - 1]);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/boards'));
    expect(
      env.fetch.mock.calls.filter(([url]) => String(url).endsWith('/leave')),
    ).toHaveLength(1);
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});

test('a late successful leave evicts access without navigating away from the current screen', async () => {
  mockPath = '/workspaces/' + b.id;
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const env = await setup({
    first: [a, b],
    view: 'overview',
    override: (url, init) =>
      url.pathname === '/api/workspaces/' + b.id + '/leave' &&
      init.method === 'POST'
        ? pending
        : null,
  });
  try {
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Leave workspace' }),
    );
    const buttons = screen.getAllByRole('button', { name: 'Leave workspace' });
    await fireEvent.press(buttons[buttons.length - 1]);
    mockFocused = false;
    await env.show('overview');
    await act(() =>
      finish({ status: 204, ok: true, headers: { get: () => null } }),
    );
    await screen.findByText('Resource unavailable');
    expect(mockNavigate).not.toHaveBeenCalledWith('/boards');
  } finally {
    mockFocused = true;
    mockPath = '/boards';
    await env.dispose();
  }
});

test('a late successful delete evicts access without navigating away after focus changes', async () => {
  const admin = { ...b, role: 'ADMIN', canManage: true };
  mockPath = '/workspaces/' + admin.id;
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const env = await setup({
    first: [a, admin],
    view: 'overview',
    override: (url, init) => {
      if (url.pathname === '/api/workspaces/' + admin.id + '/overview')
        return ok({
          ...overview(admin),
          visibleBoardCount: 0,
          activeBoardCount: 0,
          recentBoards: [],
        });
      if (
        url.pathname === '/api/workspaces/' + admin.id &&
        init.method === 'DELETE'
      )
        return pending;
      return null;
    },
  });
  try {
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Delete workspace' }),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Workspace name'),
      admin.name,
    );
    const buttons = screen.getAllByRole('button', { name: 'Delete workspace' });
    await fireEvent.press(buttons[buttons.length - 1]);
    mockFocused = false;
    await env.show('overview');
    await act(() =>
      finish({ status: 204, ok: true, headers: { get: () => null } }),
    );
    await screen.findByText('Resource unavailable');
    expect(mockNavigate).not.toHaveBeenCalledWith('/boards');
    expect(
      env.fetch.mock.calls.filter(([, init]) => init.method === 'DELETE'),
    ).toHaveLength(1);
  } finally {
    mockFocused = true;
    mockPath = '/boards';
    await env.dispose();
  }
});

test('an uncertain leave hides the workspace until access is rechecked', async () => {
  mockPath = '/workspaces/' + b.id;
  let lost = false;
  const env = await setup({
    first: [a, b],
    view: 'overview',
    override: (url, init) => {
      if (
        url.pathname === '/api/workspaces/' + b.id + '/leave' &&
        init.method === 'POST'
      ) {
        lost = true;
        return fail(503);
      }
      if (url.pathname === '/api/workspaces/' + b.id && lost) return fail(404);
      return null;
    },
  });
  try {
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Leave workspace' }),
    );
    const buttons = screen.getAllByRole('button', { name: 'Leave workspace' });
    await fireEvent.press(buttons[buttons.length - 1]);
    await screen.findByText('Verify workspace access');
    expect(screen.queryByText(/Design and research/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Check access' }));
    await screen.findByText('Resource unavailable');
    expect(screen.queryByText(/Design and research/)).toBeNull();
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});

test('a forbidden edit hides protected content until membership is rechecked', async () => {
  const admin = { ...b, role: 'ADMIN', canManage: true };
  mockPath = '/workspaces/' + admin.id;
  let downgraded = false;
  const env = await setup({
    first: [admin],
    view: 'overview',
    override: (url, init) => {
      if (url.pathname !== '/api/workspaces/' + admin.id) return null;
      if (init.method === 'PATCH') {
        downgraded = true;
        return fail(403);
      }
      if (downgraded) return ok({ ...admin, role: 'MEMBER', canManage: false });
      return null;
    },
  });
  try {
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Edit workspace' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Draft');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Verify workspace access');
    expect(screen.queryByText(/Design and research/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Check access' }));
    await screen.findByText(/Design and research/);
    expect(screen.queryByRole('button', { name: 'Edit workspace' })).toBeNull();
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});

test('a forbidden edit retains its draft if admin access is reconfirmed', async () => {
  const admin = { ...b, role: 'ADMIN', canManage: true };
  mockPath = '/workspaces/' + admin.id;
  const env = await setup({
    first: [admin],
    view: 'overview',
    override: (url, init) =>
      url.pathname === '/api/workspaces/' + admin.id && init.method === 'PATCH'
        ? fail(403)
        : null,
  });
  try {
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Edit workspace' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Name'), 'My draft');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Verify workspace access');
    expect(screen.queryByDisplayValue('My draft')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Check access' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Edit workspace' }),
    );
    expect(screen.getByLabelText('Name').props.value).toBe('My draft');
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});

test.each([400, 409, 503])(
  'edit preserves the draft after HTTP %s and retries only on user action',
  async (status) => {
    const admin = {
      ...b,
      role: 'ADMIN',
      canManage: true,
      description: 'Original',
    };
    mockPath = '/workspaces/' + admin.id;
    let rejected = true;
    const env = await setup({
      first: [admin],
      view: 'overview',
      override: (url, init) => {
        if (
          url.pathname !== '/api/workspaces/' + admin.id ||
          init.method !== 'PATCH'
        )
          return null;
        return rejected
          ? fail(status)
          : ok({ ...admin, description: 'Draft description' });
      },
    });
    try {
      await fireEvent.press(
        await screen.findByRole('button', { name: 'Edit workspace' }),
      );
      await fireEvent.changeText(
        screen.getByLabelText('Description (optional)'),
        'Draft description',
      );
      await fireEvent.press(
        screen.getByRole('button', { name: 'Save changes' }),
      );
      await screen.findByText(
        status === 503
          ? 'Couldn’t load the latest data. Try again.'
          : 'The request failed.',
      );
      expect(screen.getByLabelText('Description (optional)').props.value).toBe(
        'Draft description',
      );
      expect(
        env.fetch.mock.calls.filter(([, init]) => init.method === 'PATCH'),
      ).toHaveLength(1);
      rejected = false;
      await fireEvent.press(
        screen.getByRole('button', { name: 'Save changes' }),
      );
      await waitFor(() =>
        expect(
          env.fetch.mock.calls.filter(([, init]) => init.method === 'PATCH'),
        ).toHaveLength(2),
      );
    } finally {
      await env.dispose();
      mockPath = '/boards';
    }
  },
);

test('a missing workspace on leave immediately evicts its protected content', async () => {
  mockPath = '/workspaces/' + b.id;
  const env = await setup({
    first: [a, b],
    view: 'overview',
    override: (url, init) =>
      url.pathname === '/api/workspaces/' + b.id + '/leave' &&
      init.method === 'POST'
        ? fail(404)
        : null,
  });
  try {
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Leave workspace' }),
    );
    const buttons = screen.getAllByRole('button', { name: 'Leave workspace' });
    await fireEvent.press(buttons[buttons.length - 1]);
    await screen.findByText('Resource unavailable');
    expect(screen.queryByText(/Design and research/)).toBeNull();
    expect(screen.queryByText('1 visible boards')).toBeNull();
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});

test('editing the name leaves an untouched description out of PATCH', async () => {
  const admin = {
    ...b,
    role: 'ADMIN',
    canManage: true,
    description: '  retained  ',
  };
  mockPath = '/workspaces/' + admin.id;
  const env = await setup({
    first: [admin],
    view: 'overview',
    override: (url, init) =>
      url.pathname === '/api/workspaces/' + admin.id && init.method === 'PATCH'
        ? ok(admin)
        : null,
  });
  try {
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Edit workspace' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Renamed');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        env.fetch.mock.calls.some(([, init]) => init.method === 'PATCH'),
      ).toBe(true),
    );
    expect(
      JSON.parse(
        env.fetch.mock.calls.find(([, init]) => init.method === 'PATCH')[1]
          .body,
      ),
    ).toEqual({ name: 'Renamed' });
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});

test('a remote rename while editing does not get overwritten by an untouched name', async () => {
  const admin = {
    ...b,
    role: 'ADMIN',
    canManage: true,
    description: 'Original',
  };
  mockPath = '/workspaces/' + admin.id;
  const env = await setup({
    first: [admin],
    view: 'overview',
    override: (url, init) =>
      url.pathname === '/api/workspaces/' + admin.id && init.method === 'PATCH'
        ? ok(admin)
        : null,
  });
  try {
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Edit workspace' }),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Description (optional)'),
      'New description',
    );
    await act(() =>
      env.data.queryClient.setQueryData(
        [
          'mobile',
          'private',
          USER_A,
          env.manager.getSnapshot().generation,
          'workspaces',
          admin.id,
        ],
        { ...admin, name: 'Remote rename' },
      ),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        env.fetch.mock.calls.some(([, init]) => init.method === 'PATCH'),
      ).toBe(true),
    );
    expect(
      JSON.parse(
        env.fetch.mock.calls.find(([, init]) => init.method === 'PATCH')[1]
          .body,
      ),
    ).toEqual({ description: 'New description' });
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});

test('a server-confirmed admin downgrade closes the editing controls', async () => {
  const admin = { ...b, role: 'ADMIN', canManage: true };
  mockPath = '/workspaces/' + admin.id;
  const env = await setup({ first: [admin], view: 'overview' });
  try {
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Edit workspace' }),
    );
    await act(() =>
      env.data.queryClient.setQueryData(
        [
          'mobile',
          'private',
          USER_A,
          env.manager.getSnapshot().generation,
          'workspaces',
          admin.id,
        ],
        { ...admin, role: 'MEMBER', canManage: false },
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: 'Edit workspace' })).toBeNull();
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});

test('Personal and non-admin workspaces do not expose Team management actions', async () => {
  mockPath = '/workspaces/' + a.id;
  const env = await setup({ first: [a, b], view: 'overview' });
  try {
    await screen.findByText('1 visible boards');
    expect(
      screen.queryByRole('button', { name: 'Leave workspace' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Delete workspace' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit workspace' })).toBeNull();
    await env.show(null);
    mockPath = '/workspaces/' + b.id;
    await env.show('overview');
    await screen.findByRole('button', { name: 'Leave workspace' });
    expect(
      screen.queryByRole('button', { name: 'Delete workspace' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit workspace' })).toBeNull();
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});

test('a late create response cannot select a workspace after an account switch', async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const env = await setup({
    override: (url, init) =>
      url.pathname === '/api/workspaces' && init.method === 'POST'
        ? pending
        : null,
  });
  try {
    await fireEvent.press(await trigger());
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create new workspace' }),
    );
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Late team');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Create workspace' }),
    );
    await act(() => env.manager.establishSession(loginResponse(USER_B)));
    const created = {
      ...workspace(9),
      name: 'Late team',
      role: 'ADMIN',
      canManage: true,
    };
    await act(() =>
      finish({
        ...envelope(
          { success: true, statusCode: 201, message: 'Created', data: created },
          201,
        ),
        ok: true,
      }),
    );
    await screen.findByText('No boards in this workspace');
    expect(mockNavigate).not.toHaveBeenCalledWith('/workspaces/' + created.id);
    expect(screen.queryByText('Late team')).toBeNull();
  } finally {
    await env.dispose();
  }
});

test.each([
  [0, 0],
  [3000, 3000],
  [Infinity, MAX_AUTOMATIC_RETRY_DELAY_MS],
  [NaN, MAX_AUTOMATIC_RETRY_DELAY_MS],
])(
  'manual retry with retryAfterMs=%s is available after %s ms',
  (delay, cooldown) => {
    const error = new ApiError('http', { status: 429, retryAfterMs: delay });
    const updatedAt = Date.now();
    const clock = jest.spyOn(Date, 'now');
    try {
      if (cooldown > 0) {
        clock.mockReturnValue(updatedAt + cooldown - 1);
        expect(canRetryWorkspace(error, updatedAt)).toBe(false);
      }
      clock.mockReturnValue(updatedAt + cooldown);
      expect(canRetryWorkspace(error, updatedAt)).toBe(true);
    } finally {
      clock.mockRestore();
    }
  },
);

test('an invalid Retry-After disables the directory button until the bounded manual cooldown expires', async () => {
  jest.useFakeTimers();
  let limited = true;
  const env = await setup({
    override: (url) =>
      url.pathname === '/api/workspaces' && limited
        ? envelope({}, 429, 'invalid-policy')
        : null,
  });
  try {
    const retry = () =>
      screen.getByRole('button', { name: 'Retry workspaces' });
    await screen.findByRole('button', { name: 'Retry workspaces' });
    expect(retry()).toBeDisabled();
    await fireEvent.press(retry());
    expect(env.fetch).toHaveBeenCalledTimes(1);
    limited = false;
    await act(() => jest.advanceTimersByTime(MAX_AUTOMATIC_RETRY_DELAY_MS));
    expect(retry()).toBeEnabled();
    await fireEvent.press(retry());
    await screen.findByText('Personal planning');
    expect(
      env.fetch.mock.calls.filter(
        ([url]) => new URL(url).pathname === '/api/workspaces',
      ),
    ).toHaveLength(2);
  } finally {
    await env.dispose();
    jest.useRealTimers();
  }
});

test('failed detail verification after remount hides cached Workspace details until a successful retry', async () => {
  mockPath = '/workspaces/' + b.id;
  let unavailable = false;
  const env = await setup({
    view: 'overview',
    override: (url) =>
      url.pathname === '/api/workspaces/' + b.id && unavailable
        ? fail(503)
        : null,
  });
  try {
    await screen.findByText('1 visible boards');
    await env.show(null);
    unavailable = true;
    await env.show('overview');
    await screen.findByText('Workspace unavailable');
    expect(screen.queryByText(/Design and research/)).toBeNull();
    expect(screen.queryByText('1 visible boards')).toBeNull();
    expect(
      env.fetch.mock.calls.filter(([url]) => String(url).endsWith('/overview')),
    ).toHaveLength(1);
    unavailable = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText(/Design and research/);
    expect(screen.getByText('1 visible boards')).toBeTruthy();
  } finally {
    await env.dispose();
    mockPath = '/boards';
  }
});
test('a selected Workspace denied during its Board request falls back without exposing the old selection', async () => {
  let resolveDenied;
  const held = new Promise((resolve) => {
    resolveDenied = resolve;
  });
  const env = await setup({
    override: (url) =>
      url.pathname === '/api/workspaces/' + b.id + '/boards' ? held : null,
  });
  try {
    await screen.findByText('Personal planning');
    await switchTo(/Select Design and research/);
    await screen.findByRole('progressbar', { name: 'Loading boards' });
    expect(screen.queryByText('Personal planning')).toBeNull();
    await act(() => resolveDenied(fail(403)));
    await screen.findByText('Personal planning');
    expect((await trigger()).props.accessibilityLabel).toMatch(
      /Personal Workspace/,
    );
    await fireEvent.press(await trigger());
    expect(
      screen.queryByRole('button', { name: /Select Design and research/ }),
    ).toBeNull();
  } finally {
    await env.dispose();
  }
});
