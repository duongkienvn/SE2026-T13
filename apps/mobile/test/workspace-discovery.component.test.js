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
import { BoardsScreen } from '../src/features/workspaces/BoardsScreen';
import { WorkspaceOverviewScreen } from '../src/features/workspaces/WorkspaceOverviewScreen';
import { WorkspaceSelectionProvider } from '../src/features/workspaces/WorkspaceSelection';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { createMobileDataLayer } from '../src/infrastructure/query/data-layer';
import { createHttpClient } from '../src/infrastructure/api/client';
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
import { board, overview, page, workspace } from './workspaces/fixtures';

const mockNavigate = jest.fn();
let mockPath = '/boards';
let mockFocused = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate, push: mockNavigate }),
  usePathname: () => mockPath,
  useIsFocused: () => mockFocused,
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
function envelope(result, status = 200) {
  return {
    status,
    ok: status === 200,
    headers: {
      get: (key) => (key === 'content-type' ? 'application/json' : null),
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
          boards.filter((item) => item.workspaceId === id),
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
  const tree = (shown) => (
    <SessionProvider manager={manager}>
      <DataProvider layer={data}>
        <WorkspaceSelectionProvider>
          <NavigationProvider adapter={adapter}>
            <ThemeContext.Provider value="dark">
              {shown === 'boards' && <BoardsScreen />}
              {shown === 'overview' && <WorkspaceOverviewScreen />}
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
    fetch,
    show: (shown) => mounted.rerender(tree(shown)),
    async dispose() {
      await mounted.unmount();
      data.dispose();
      manager.dispose();
    },
  };
}

const trigger = () =>
  screen.findByRole('button', {
    name: /^Switch workspace\. Current workspace/,
  });
const switchTo = async (label) => {
  await fireEvent.press(await trigger());
  await fireEvent.press(await screen.findByRole('button', { name: label }));
};

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
