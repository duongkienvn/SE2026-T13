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
import { onlineManager } from '@tanstack/react-query';
import BoardRoute from '../src/app/(private)/boards/[boardId]/index';
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
import { ThemeContext } from '../src/ui';
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
  column,
  card,
  boardId,
  boardDetail,
  preview,
} from './workspaces/kanban-fixtures';
import { page, uuid, workspace } from './workspaces/fixtures';

const mockPush = jest.fn();
const mockRouter = { push: mockPush };
let mockFocus = true;
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useIsFocused: () => mockFocus,
  useLocalSearchParams: () => ({
    boardId: '00000000-0000-4000-8000-0000000003e9',
  }),
  usePathname: () => '/boards/00000000-0000-4000-8000-0000000003e9',
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
    value: ({ visible, children }) =>
      visible ? (
        <native.View testID="filter-modal">{children}</native.View>
      ) : null,
  };
  return Object.create(Object.getPrototypeOf(native), descriptors);
});

function response(data, status = 200, retryAfter) {
  return {
    status,
    ok: status === 200,
    headers: {
      get: (header) =>
        header === 'content-type'
          ? 'application/json'
          : header === 'retry-after'
            ? (retryAfter ?? null)
            : null,
    },
    text: async () => JSON.stringify(data),
  };
}
const result = (data) =>
  response({ success: true, statusCode: 200, message: 'OK', data });

async function setup({
  cards = [],
  columns = [column(1)],
  board = boardDetail,
  override,
  mode = 'light',
} = {}) {
  mockFocus = true;
  mockPush.mockClear();
  onlineManager.setOnline(true);
  const time = new FakeTime();
  const auth = new FakeSessionApi();
  auth.auto = (token) => ({
    kind: 'verified',
    user: user(token === loginResponse(USER_B).accessToken ? USER_B : USER_A),
  });
  const manager = createSessionManager({
    api: auth,
    store: createCredentialStore(new MemorySecureStore()),
    clock: time,
    timers: time,
  });
  await manager.establishSession(loginResponse(USER_A));
  const requests = [];
  const fetch = async (input, options) => {
    const url = new URL(input);
    requests.push({
      path: url.pathname,
      params: url.searchParams,
      method: options.method,
    });
    const custom = override?.(url, manager.getSnapshot());
    if (custom) return custom;
    const number = Number(url.searchParams.get('page'));
    if (url.pathname === '/api/users/me/preferences')
      return result({ timeZone: 'Asia/Bangkok' });
    if (url.pathname === `/api/workspaces/${board.workspaceId}`)
      return result(workspace());
    if (url.pathname === `/api/boards/${boardId}`) return result(board);
    if (url.pathname.endsWith('/columns'))
      return response(page(columns, number, 100));
    if (url.pathname.endsWith('/cards')) {
      const q = url.searchParams.get('q');
      return response(
        page(
          cards.filter((card) => !q || card.title.includes(q)),
          number,
          100,
        ),
      );
    }
    if (url.pathname.endsWith('/card-preview-summaries'))
      return result({
        summaries: url.searchParams.get('cardIds').split(',').map(preview),
      });
    if (url.pathname.endsWith('/labels') || url.pathname.endsWith('/members'))
      return response(page([], number, 100));
    if (url.pathname.endsWith('/views') || url.pathname.endsWith('/user-state'))
      return result({ isStarred: false, lastViewedAt: null });
    return response({}, 404);
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
  const realtime = createNativeRealtime({
    manager,
    data,
    createSocket: null,
    timers: time,
  });
  const adapter = createNavigationSessionAdapter(manager);
  const tree = () => (
    <SessionProvider manager={manager}>
      <DataProvider layer={data}>
        <RealtimeProvider client={realtime}>
          <NavigationProvider adapter={adapter}>
            <ThemeContext.Provider value={mode}>
              <BoardRoute />
            </ThemeContext.Provider>
          </NavigationProvider>
        </RealtimeProvider>
      </DataProvider>
    </SessionProvider>
  );
  const mounted = await render(tree());
  return {
    manager,
    data,
    realtime,
    time,
    reads: (suffix) => requests.filter(({ path }) => path.endsWith(suffix)),
    focus: async (focused) => {
      mockFocus = focused;
      await mounted.rerender(tree());
    },
    async dispose() {
      await mounted.unmount();
      realtime.dispose();
      data.dispose();
      manager.dispose();
      onlineManager.setOnline(true);
    },
  };
}

const button = (name) => screen.findByRole('button', { name });

test.each([
  [0, 1],
  [1, 10],
  [100, 30],
  [101, 30],
  [251, 101],
])(
  '%i Cards and %i Columns count all records with on-demand pages and bounded previews',
  async (count, columnCount) => {
    const env = await setup({
      cards: Array.from({ length: count }, (_, i) =>
        card(i + 1, column(i >= 100 ? 2 : 1).id),
      ),
      columns: Array.from({ length: columnCount }, (_, i) =>
        column(i + 1),
      ).reverse(),
    });
    try {
      await screen.findByText('Product Roadmap');
      expect(screen.getByText('Read-only')).toBeTruthy();
      if (count > 100) {
        await screen.findByText(`Loaded 100 of ${count} cards`);
        await screen.findAllByText('No cards loaded here yet.');
        expect(env.reads('/cards')).toHaveLength(1);
        await fireEvent.press(await button('Load more cards'));
      }
      if (count > 200) {
        await screen.findByText(`Loaded 200 of ${count} cards`);
        await fireEvent.press(await button('Load more cards'));
      }
      if (columnCount > 100) {
        await screen.findByText('100 of 101 columns loaded');
        await fireEvent.press(await button('Load more columns'));
        await waitFor(() => expect(env.reads('/columns')).toHaveLength(2));
      }
      await screen.findByText(`${count} ${count === 1 ? 'card' : 'cards'}`);
      if (count) {
        await button(
          /^Card 1, 1\/2 checklist items, 2 attachments, 3 comments$/,
        );
        expect(screen.queryAllByText('No cards loaded here yet.')).toHaveLength(
          0,
        );
      }
      const pages = Math.max(1, Math.ceil(count / 100));
      await waitFor(() =>
        expect(env.reads('/card-preview-summaries')).toHaveLength(
          count ? pages : 0,
        ),
      );
      expect(
        env.reads('/cards').map(({ params }) => params.get('page')),
      ).toEqual(Array.from({ length: pages }, (_, i) => String(i + 1)));
      expect(
        env
          .reads('/card-preview-summaries')
          .every(
            ({ params }) => params.get('cardIds').split(',').length <= 100,
          ),
      ).toBe(true);
      expect(env.reads('/views')).toHaveLength(1);
      // Native FlatLists mount a render window rather than 30/101 panels.
      if (columnCount >= 30)
        expect(screen.queryAllByText(/^Column \d+$/).length).toBeLessThan(
          columnCount,
        );
    } finally {
      await env.dispose();
    }
  },
);

test('filter draft, cancel, reset and reapplying filters use server page one with authorized catalog choices', async () => {
  const label = { id: uuid(15), boardId, name: 'Design', color: '#615CF7' };
  const env = await setup({
    cards: [card(1), { ...card(2), title: 'Search hit' }],
    override(url) {
      if (url.pathname.endsWith('/members')) return response({}, 403);
      if (url.pathname.endsWith('/labels'))
        return response(page([label], 1, 100));
      return null;
    },
  });
  try {
    await screen.findByText('2 cards');
    await fireEvent.press(await button('Filters'));
    await fireEvent.changeText(
      screen.getByLabelText('Search cards'),
      ' Search ',
    );
    await fireEvent.press(await button('Cancel'));
    expect(env.reads('/cards')).toHaveLength(1);
    await fireEvent.press(await button('Filters'));
    expect(screen.getByLabelText('Search cards').props.value).toBe('');
    await fireEvent.press(await button('Assignees'));
    await screen.findByText('Assignees are unavailable.');
    const filters = within(screen.getByTestId('filter-modal'));
    await fireEvent.press(
      await filters.findByRole('button', { name: 'Labels' }),
    );
    await fireEvent.press(
      await filters.findByRole('button', { name: 'Design' }),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Search cards'),
      ' Search ',
    );
    await fireEvent.press(
      await filters.findByRole('button', { name: 'Due today' }),
    );
    await fireEvent.press(await button('Apply filters (3)'));
    await button(/^Search hit,/);
    const applied = env.reads('/cards').at(-1).params;
    expect([
      applied.get('page'),
      applied.get('q'),
      applied.get('labelIds'),
      applied.get('dueStatus'),
    ]).toEqual(['1', 'Search', label.id, 'DUE_TODAY']);
    await fireEvent.press(await button('Filters (3)'));
    await fireEvent.press(await button('Reset'));
    await fireEvent.press(await button('Apply filters (0)'));
    await screen.findByText('2 cards');
    expect(env.reads('/cards').map(({ params }) => params.get('q'))).toEqual([
      null,
      'Search',
      null,
    ]);
    expect(screen.queryByText('Board unavailable')).toBeNull();
  } finally {
    await env.dispose();
  }
});

test('guest and archived reading survives restricted Workspace context; Card navigation preserves filters and does not record another view', async () => {
  const env = await setup({
    board: {
      ...boardDetail,
      currentUserRole: 'MEMBER',
      visibility: 'PRIVATE',
      isArchived: true,
      archivedAt: boardDetail.createdAt,
    },
    cards: [card(1)],
    mode: 'dark',
    override(url) {
      return url.pathname.startsWith('/api/workspaces/')
        ? response({}, 404)
        : null;
    },
  });
  try {
    await screen.findByText('Workspace details unavailable');
    await screen.findByText('Archived · Read-only');
    expect(screen.queryByRole('button', { name: 'Add card' })).toBeNull();
    expect(
      screen.getByRole('tab', { name: 'Table, coming soon' }).props
        .accessibilityState.disabled,
    ).toBe(true);
    await fireEvent.press(await button('Due today'));
    await button('Filters (1)');
    await fireEvent.press(await button(/^Card 1,/));
    expect(mockPush).toHaveBeenCalledWith(
      `/boards/${boardId}/cards/${card(1).id}`,
    );
    await env.focus(false);
    await env.focus(true);
    await button('Filters (1)');
    expect(env.reads('/cards').at(-1).params.get('dueStatus')).toBe(
      'DUE_TODAY',
    );
    expect(env.reads('/views')).toHaveLength(1);
  } finally {
    await env.dispose();
  }
});

test('preview failure keeps the Card readable; confirmed revocation clears protected content and caches', async () => {
  let allowed = true;
  let previews = false;
  const env = await setup({
    cards: [card(1)],
    override(url) {
      if (url.pathname.endsWith('/card-preview-summaries') && !previews)
        return response({}, 500);
      if (url.pathname.endsWith(boardId) && !allowed) return response({}, 404);
      return null;
    },
  });
  try {
    await button('Card 1');
    await screen.findByText('Some card summaries are unavailable.');
    previews = true;
    await fireEvent.press(await button('Retry card summaries'));
    await button(/^Card 1, 1\/2 checklist items/);
    allowed = false;
    await env.focus(false);
    await env.focus(true);
    await screen.findByText('Board unavailable');
    expect(screen.queryByText('Product Roadmap')).toBeNull();
    expect(screen.queryByText('Card 1')).toBeNull();
    expect(
      env.data.queryClient
        .getQueriesData({
          queryKey: queryKeys.board(env.data.getIdentity(), boardId),
        })
        .every(([, value]) => value === undefined),
    ).toBe(true);
  } finally {
    await env.dispose();
  }
});

test('429 exposes a retry, offline hides verified content, and stale Board responses cannot cross accounts', async () => {
  const slow = deferred();
  let attempt = 0;
  const env = await setup({
    cards: [card(1)],
    override(url, session) {
      if (!url.pathname.endsWith(boardId)) return null;
      if (session.user.id === USER_B) return response({}, 404);
      attempt++;
      if (attempt === 1) return response({}, 429, '0');
      if (attempt === 2) return null;
      return slow.promise;
    },
  });
  try {
    await screen.findByText('Too many requests. Try again shortly.');
    await fireEvent.press(await button('Retry board'));
    await button(/^Card 1/);
    await act(() => onlineManager.setOnline(false));
    await screen.findByText('Connection unavailable');
    expect(screen.queryByText('Card 1')).toBeNull();
    await act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(attempt).toBeGreaterThan(2));
    await act(() => env.manager.establishSession(loginResponse(USER_B)));
    await act(() => slow.resolve(result(boardDetail)));
    await screen.findByText('Board unavailable');
    expect(screen.queryByText('Product Roadmap')).toBeNull();
    expect(screen.queryByText('Card 1')).toBeNull();
  } finally {
    slow.resolve(result(boardDetail));
    await env.dispose();
  }
});

test('HTTP 401 ends the matching session and purges private Card and Board queries', async () => {
  let expired = false;
  const env = await setup({
    cards: [card(1)],
    override(url) {
      return expired && url.pathname.endsWith(boardId)
        ? response({}, 401)
        : null;
    },
  });
  try {
    await button(/^Card 1/);
    const identity = env.data.getIdentity();
    expired = true;
    await env.focus(false);
    await env.focus(true);
    await waitFor(() =>
      expect(env.manager.getSnapshot()).toMatchObject({
        status: 'unauthenticated',
        reason: 'unauthorized',
      }),
    );
    expect(screen.queryByText('Product Roadmap')).toBeNull();
    expect(
      env.data.queryClient.getQueriesData({
        queryKey: queryKeys.board(identity, boardId),
      }),
    ).toHaveLength(0);
  } finally {
    await env.dispose();
  }
});
