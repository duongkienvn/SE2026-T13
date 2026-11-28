/* global jest, test, expect */
import { URL } from 'node:url';
import { FlatList } from 'react-native';
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
import { BoardKanban } from '../src/features/boards/BoardKanban';
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
  cardDto as card,
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
    value: ({ visible, onRequestClose, children }) =>
      visible ? (
        <native.View testID="filter-modal" onTouchEnd={onRequestClose}>
          {children}
        </native.View>
      ) : null,
  };
  return Object.create(Object.getPrototypeOf(native), descriptors);
});

function response(data, status = 200, retryAfter) {
  return {
    status,
    ok: status >= 200 && status < 300,
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
const result = (data, status = 200) =>
  response({ success: true, statusCode: status, message: 'OK', data }, status);

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
      body: options.body ? JSON.parse(options.body) : undefined,
    });
    const custom = override?.(url, manager.getSnapshot(), requests.at(-1));
    if (custom) return custom;
    const number = Number(url.searchParams.get('page'));
    if (url.pathname === '/api/users/me/preferences')
      return result({
        theme: 'system',
        weekStartsOn: 'monday',
        dateFormat: 'YYYY-MM-DD',
        timeZone: 'Asia/Bangkok',
      });
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
    createHttpClient({
      baseUrl: new URL('https://example.test/api'),
      fetch,
      isOnline: () => onlineManager.isOnline(),
    }),
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
  const tree = (showBoard = true) => (
    <SessionProvider manager={manager}>
      <DataProvider layer={data}>
        <RealtimeProvider client={realtime}>
          <NavigationProvider adapter={adapter}>
            <ThemeContext.Provider value={mode}>
              {showBoard && <BoardRoute />}
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
    showBoard: (show) => mounted.rerender(tree(show)),
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

const button = (name) =>
  screen.findByRole('button', { name }, { timeout: 4000 });

test('Card previews resolve later label pages once for the Board and filters reuse them', async () => {
  const labels = Array.from({ length: 101 }, (_, index) => ({
    id: uuid(5000 + index),
    boardId,
    name: index === 0 ? 'Planning' : `Label ${index + 1}`,
    color: '#615CF7',
  }));
  const firstCard = card(1);
  const env = await setup({
    cards: [firstCard],
    override(url) {
      if (url.pathname.endsWith('/labels'))
        return response(
          page(labels, Number(url.searchParams.get('page')), 100),
        );
      if (url.pathname.endsWith('/card-preview-summaries'))
        return result({
          summaries: [
            {
              ...preview(firstCard.id),
              labelIds: [labels[0].id, labels[100].id],
            },
          ],
        });
      return null;
    },
  });
  try {
    await button(/^Card 1, Planning, Label 101,/);
    await fireEvent.press(await button('Labels'));
    const sheet = within(screen.getByTestId('filter-modal'));
    expect(await sheet.findByText('Label 101')).toBeTruthy();
    await fireEvent.press(await sheet.findByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Planning')).toBeTruthy();
    expect(screen.getByText('Label 101')).toBeTruthy();
    expect(screen.queryByText('1 unresolved label')).toBeNull();
    expect(
      env.reads('/labels').map(({ params }) => params.get('page')),
    ).toEqual(['1', '2']);
  } finally {
    await env.dispose();
  }
});

test.each([false, true])(
  'restores both scroll axes after content grows or loading completes (complete: %s)',
  async (complete) => {
    const renderList = jest.spyOn(FlatList.prototype, 'render');
    const scrollToOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    scrollToOffset.mockImplementation(() => {});
    const firstColumn = column(1);
    const scroll = { x: 1000, cards: new Map([[firstColumn.id, 1000]]) };
    const props = {
      columns: [firstColumn],
      groups: new Map([[firstColumn.id, [card(1)]]]),
      cardsReady: true,
      cardsComplete: true,
      previews: new Map(),
      labels: [],
      members: [],
      scroll,
      onOpen: jest.fn(),
    };
    const view = (settled) => (
      <BoardKanban
        {...props}
        columnsComplete={settled}
        cardsLoading={!settled}
      />
    );
    const mounted = await render(view(false));
    try {
      const horizontal = renderList.mock.contexts.find(
        (list) => list.props.horizontal,
      );
      const vertical = renderList.mock.contexts.find(
        (list) => !list.props.horizontal,
      );
      await act(() => {
        horizontal.props.onLayout({ nativeEvent: { layout: { width: 500 } } });
        vertical.props.onLayout({ nativeEvent: { layout: { height: 500 } } });
        horizontal.props.onContentSizeChange(1200, 0);
        vertical.props.onContentSizeChange(0, 350);
      });
      expect(scrollToOffset).not.toHaveBeenCalled();

      if (complete) {
        // Loading can finish without another native size event.
        await mounted.rerender(view(true));
      } else {
        await act(() => {
          horizontal.props.onContentSizeChange(1600, 0);
          vertical.props.onContentSizeChange(0, 1600);
        });
      }
      await waitFor(() => expect(scrollToOffset).toHaveBeenCalledTimes(2));
      expect(scrollToOffset).toHaveBeenCalledWith({
        offset: complete ? 700 : 1000,
        animated: false,
      });
      expect(scrollToOffset).toHaveBeenCalledWith({
        offset: complete ? 0 : 1000,
        animated: false,
      });
      expect(scroll.x).toBe(complete ? 700 : 1000);
      expect(scroll.cards.get(firstColumn.id)).toBe(complete ? 0 : 1000);
    } finally {
      await mounted.unmount();
      scrollToOffset.mockRestore();
      renderList.mockRestore();
    }
  },
);

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
      screen.getByRole('tab', { name: 'Table' }).props.accessibilityState
        .selected,
    ).toBe(false);
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

const writableBoard = {
  ...boardDetail,
  currentUserRole: 'OWNER',
  visibility: 'PRIVATE',
  capabilities: { ...boardDetail.capabilities, canWriteBoard: true },
};
const columnError = (status, code) =>
  response(
    {
      success: false,
      statusCode: status,
      code,
      message: 'Column request failed',
      details: [],
    },
    status,
  );
const columnSheet = () => within(screen.getByTestId('filter-modal'));
const pressColumn = async (name) =>
  fireEvent.press(await columnSheet().findByRole('button', { name }));
const selectColumn = async (name) =>
  fireEvent.press(await button(`Column actions for ${name}`));
const selectCard = async (name) =>
  fireEvent.press(await button(`Card actions for ${name}`));

test('creates, renames, reorders, moves, duplicates, archives and restores a Card through accessible Board actions', async () => {
  const first = column(1);
  const second = column(2);
  const keep = card(1);
  let rows = [keep];
  let restoreUnavailable = true;
  const env = await setup({
    board: writableBoard,
    columns: [first, second],
    override(url, _session, request) {
      const [, cardId, action] =
        url.pathname.match(/\/cards\/([^/]+)(?:\/([^/]+))?$/) ?? [];
      if (url.pathname.endsWith('/cards')) {
        if (request.method === 'POST') {
          const added = {
            ...card(2, request.body.columnId),
            title: request.body.title,
          };
          rows.push(added);
          return result(added, 201);
        }
        const archived = url.searchParams.get('status') === 'archived';
        const columnId = url.searchParams.get('columnId');
        const matching = rows.filter(
          (item) =>
            item.isArchived === archived &&
            (!columnId || item.columnId === columnId),
        );
        return response(
          page(matching, Number(url.searchParams.get('page')), 100),
        );
      }
      if (!cardId) return null;
      const item = rows.find((row) => row.id === cardId);
      if (!item) return columnError(404, 'CARD_NOT_FOUND');
      if (request.method === 'GET') return result(item);
      if (action === 'restore' && restoreUnavailable)
        return columnError(409, 'CARD_COLUMN_UNAVAILABLE');
      if (action === 'duplicate') {
        const copy = {
          ...item,
          id: uuid(3100),
          columnId: request.body.columnId ?? item.columnId,
          position: '10.0000000000',
        };
        rows.push(copy);
        return result(copy, 201);
      }
      const next = {
        ...item,
        ...(action === 'move'
          ? {
              columnId: request.body.toColumnId,
              position: request.body.beforeCardId
                ? '0.0000000000'
                : '8.0000000000',
            }
          : {}),
        ...(action === 'archive'
          ? { isArchived: true, archivedAt: boardDetail.createdAt }
          : {}),
        ...(action === 'restore'
          ? { isArchived: false, archivedAt: null, position: '11.0000000000' }
          : {}),
        ...(!action ? { title: request.body.title } : {}),
      };
      rows = [...rows.filter(({ id }) => id !== cardId), next].sort(
        (a, b) => Number(a.position) - Number(b.position),
      );
      return result(next);
    },
  });
  try {
    await button('Card actions for Card 1');
    await fireEvent.press(
      screen.getAllByRole('button', { name: 'Add card' })[0],
    );
    await pressColumn('Create card');
    await screen.findByText('Enter a card title.');
    await fireEvent.changeText(
      screen.getByLabelText('Card title'),
      '  Ship release  ',
    );
    await pressColumn('Create card');
    await button('Card actions for Ship release');
    expect(
      env
        .reads('/cards')
        .filter(({ method }) => method === 'POST')
        .map(({ body }) => body),
    ).toEqual([{ columnId: first.id, title: 'Ship release' }]);

    await selectCard('Ship release');
    await pressColumn('Rename');
    expect(screen.getByLabelText('Card title').props.value).toBe(
      'Ship release',
    );
    await fireEvent.changeText(
      screen.getByLabelText('Card title'),
      'Release ready',
    );
    await pressColumn('Cancel');
    await screen.findByText('Discard changes?');
    await pressColumn('Keep editing');
    expect(screen.getByLabelText('Card title').props.value).toBe(
      'Release ready',
    );
    await pressColumn('Save title');
    await button('Card actions for Release ready');
    expect(
      env
        .reads(`/${card(2).id}`)
        .filter(({ method }) => method === 'PATCH')
        .map(({ body }) => body),
    ).toEqual([{ title: 'Release ready', expectedTitle: 'Ship release' }]);
    expect(
      env.reads(`/${card(2).id}`).some(({ method }) => method === 'GET'),
    ).toBe(false);

    await selectCard('Release ready');
    await pressColumn('Move to…');
    await pressColumn('Move up');
    await screen.findByText('Card moved.');
    expect(env.reads('/move').at(-1).body).toEqual({
      toColumnId: first.id,
      beforeCardId: keep.id,
    });
    await selectCard('Release ready');
    await pressColumn('Move to…');
    await pressColumn('Column 2');
    await pressColumn('Move to end of column');
    await screen.findByText('Card moved.');
    expect(env.reads('/move').at(-1).body).toEqual({
      toColumnId: second.id,
      beforeCardId: null,
    });

    await selectCard('Release ready');
    await pressColumn('Duplicate');
    await screen.findByText(
      /Assignees, comments, activity and attachments stay with the original/,
    );
    await pressColumn('Column 1');
    await pressColumn('Duplicate card');
    await screen.findByText('Card duplicated.');
    expect(env.reads('/duplicate')[0].body).toEqual({ columnId: first.id });

    // The first-column duplicate has the same name. Archive it while keeping the cross-column source active.
    await fireEvent.press(
      screen.getAllByRole('button', {
        name: 'Card actions for Release ready',
      })[0],
    );
    await pressColumn('Archive');
    expect(env.reads('/archive')).toHaveLength(0);
    await pressColumn('Archive card');
    await screen.findByText('Card archived.');
    expect(env.reads('/archive')[0].body).toBeUndefined();
    await fireEvent.press(await button('Board actions'));
    await pressColumn('Archived cards');
    await pressColumn('Restore Release ready');
    await pressColumn('Restore card');
    await screen.findByText(
      'The original column is unavailable. This card is still archived.',
    );
    restoreUnavailable = false;
    await pressColumn('Restore card');
    await screen.findByText('No archived cards.');
    expect(env.reads('/restore').map(({ body }) => body)).toEqual([
      undefined,
      undefined,
    ]);
    expect(rows.at(-1)).toMatchObject({
      id: uuid(3100),
      columnId: first.id,
      isArchived: false,
    });
  } finally {
    await env.dispose();
  }
});

test('an ambiguous create prevents repeat POSTs until explicit Board review and retains the long title', async () => {
  let posts = 0;
  const responseLost = deferred();
  const title = 'x'.repeat(120);
  const env = await setup({
    board: writableBoard,
    override(url, _session, request) {
      if (url.pathname.endsWith('/cards') && request.method === 'POST') {
        posts++;
        return responseLost.promise.then(() => {
          throw new Error('Connection lost after send');
        });
      }
      return null;
    },
  });
  try {
    await fireEvent.press(await button('Add card'));
    await fireEvent.changeText(screen.getByLabelText('Card title'), title);
    const save = columnSheet().getByRole('button', { name: 'Create card' });
    await fireEvent.press(save);
    await fireEvent.press(save);
    await waitFor(() => expect(posts).toBe(1));
    await act(async () => {
      onlineManager.setOnline(false);
      responseLost.resolve();
    });
    await act(() => onlineManager.setOnline(true));
    await screen.findByText(/server may have created a card/);
    expect(posts).toBe(1);
    expect(
      columnSheet().getByRole('button', { name: 'I checked the board' }).props
        .accessibilityState.disabled,
    ).toBe(true);
    await pressColumn('Review board');
    await fireEvent.press(await button('Add card'));
    expect(screen.getByLabelText('Card title').props.value).toBe(title);
    await waitFor(() =>
      expect(
        columnSheet().getByRole('button', { name: 'I checked the board' }).props
          .accessibilityState.disabled,
      ).toBe(false),
    );
    await pressColumn('I checked the board');
    expect(
      columnSheet().getByRole('button', { name: 'Create card' }).props
        .accessibilityState.disabled,
    ).toBe(false);
    expect(posts).toBe(1);
  } finally {
    await env.dispose();
  }
});

test('an archived Board can page archived Cards and open the guarded Card route without write controls', async () => {
  const archived = Array.from({ length: 101 }, (_, index) => ({
    ...card(index + 1),
    isArchived: true,
    archivedAt: boardDetail.createdAt,
  })).reverse();
  const env = await setup({
    board: {
      ...writableBoard,
      isArchived: true,
      archivedAt: boardDetail.createdAt,
    },
    override(url) {
      if (url.pathname.endsWith('/cards'))
        return response(
          page(
            url.searchParams.get('status') === 'archived'
              ? archived
              : [card(110)],
            Number(url.searchParams.get('page')),
            100,
          ),
        );
      return null;
    },
  });
  try {
    await button(/^Card 110,/);
    expect(screen.queryByRole('button', { name: 'Add card' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Card actions for Card 110' }),
    ).toBeNull();
    await fireEvent.press(await button('Board actions'));
    await pressColumn('Archived cards');
    await screen.findByText('Page 1 of 2');
    expect(screen.queryByRole('button', { name: /^Restore / })).toBeNull();
    await pressColumn('Next archive page');
    await screen.findByText('Page 2 of 2');
    await pressColumn('Card 1');
    expect(mockPush).toHaveBeenCalledWith(
      `/boards/${boardId}/cards/${archived.at(-1).id}`,
    );
    expect(
      env
        .reads('/cards')
        .filter(({ params }) => params.get('status') === 'archived')
        .map(({ params }) => params.get('page')),
    ).toEqual(['1', '2']);
  } finally {
    await env.dispose();
  }
});

test('a shrinking archive keeps Previous available from an empty later page', async () => {
  const archived = Array.from({ length: 101 }, (_, index) => ({
    ...card(index + 1),
    isArchived: true,
    archivedAt: boardDetail.createdAt,
  }));
  let shrunk = false;
  const env = await setup({
    board: writableBoard,
    override(url) {
      if (url.searchParams.get('status') !== 'archived') return null;
      const requested = Number(url.searchParams.get('page'));
      if (requested === 2) shrunk = true;
      return response(
        page(shrunk ? archived.slice(0, 100) : archived, requested, 100),
      );
    },
  });
  try {
    await fireEvent.press(await button('Board actions'));
    await pressColumn('Archived cards');
    await pressColumn('Next archive page');
    await screen.findByText(/no cards on this page/i);
    await pressColumn('Previous archive page');
    await columnSheet().findByRole('button', { name: 'Card 1' });
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Next archive page' }),
      ).toBeNull(),
    );
  } finally {
    await env.dispose();
  }
});

test('a committed create with a lost response stays gated after Board unmount', async () => {
  const post = deferred();
  const readback = deferred();
  let committed = false;
  let reviewing = false;
  const created = { ...card(1), title: 'Committed before disconnect' };
  const env = await setup({
    board: writableBoard,
    override(url, _session, request) {
      if (!url.pathname.endsWith('/cards')) return null;
      if (request.method === 'POST') {
        committed = true;
        return post.promise;
      }
      if (reviewing) return readback.promise;
      return response(page(committed ? [created] : [], 1, 100));
    },
  });
  try {
    await fireEvent.press(await button('Add card'));
    await fireEvent.changeText(
      screen.getByLabelText('Card title'),
      created.title,
    );
    await pressColumn('Create card');
    await waitFor(() => expect(committed).toBe(true));
    await env.showBoard(false);
    post.resolve(result(created, 201));
    await env.showBoard(true);
    await fireEvent.press(await button('Add card'));
    await screen.findByText(/server may have created a card/);
    expect(screen.getByLabelText('Card title').props.value).toBe(created.title);
    reviewing = true;
    await pressColumn('Review board');
    await fireEvent.press(await button('Add card'));
    expect(
      columnSheet().getByRole('button', { name: 'I checked the board' }).props
        .accessibilityState.disabled,
    ).toBe(true);
    readback.resolve(response(page([created], 1, 100)));
    await waitFor(() =>
      expect(
        columnSheet().getByRole('button', { name: 'I checked the board' }).props
          .accessibilityState.disabled,
      ).toBe(false),
    );
    await pressColumn('I checked the board');
    expect(
      columnSheet().getByRole('button', { name: 'Create card' }).props
        .accessibilityState.disabled,
    ).toBe(false);
    expect(
      env.reads('/cards').filter(({ method }) => method === 'POST'),
    ).toHaveLength(1);
  } finally {
    post.resolve(result(created, 201));
    readback.resolve(response(page([created], 1, 100)));
    await env.dispose();
  }
});

test('creates from an empty Board, validates drafts, rejects duplicate taps, and reveals the new Column', async () => {
  const create = deferred();
  let rows = [];
  const renderList = jest.spyOn(FlatList.prototype, 'render');
  const scrollToIndex = jest
    .spyOn(FlatList.prototype, 'scrollToIndex')
    .mockImplementation(() => {});
  const env = await setup({
    board: writableBoard,
    override(url, _session, request) {
      if (!url.pathname.endsWith('/columns')) return null;
      if (request.method === 'GET')
        return response(page(rows, Number(url.searchParams.get('page')), 100));
      return create.promise;
    },
  });
  try {
    await screen.findByText('No columns yet');
    await fireEvent.press(await button('Add column'));
    await pressColumn('Create column');
    await screen.findByText('Enter a column name.');
    await fireEvent.changeText(
      screen.getByLabelText('Column name'),
      'x'.repeat(121),
    );
    await pressColumn('Create column');
    await screen.findByText('Column name must be at most 120 characters.');
    await fireEvent(screen.getByTestId('filter-modal'), 'touchEnd');
    await screen.findByText('Discard changes?');
    await pressColumn('Keep editing');
    expect(screen.getByLabelText('Column name').props.value).toHaveLength(121);
    await pressColumn('Cancel');
    await screen.findByText('Discard changes?');
    await pressColumn('Discard changes');
    expect(screen.queryByTestId('filter-modal')).toBeNull();
    expect(
      env.reads('/columns').filter(({ method }) => method === 'POST'),
    ).toHaveLength(0);
    await fireEvent.press(await button('Add column'));
    expect(screen.getByLabelText('Column name').props.value).toBe('');
    await fireEvent.changeText(
      screen.getByLabelText('Column name'),
      '  In progress  ',
    );
    const createButton = await columnSheet().findByRole('button', {
      name: 'Create column',
    });
    await fireEvent.press(createButton);
    await fireEvent.press(createButton);
    await screen.findByText('Saving column changes…');
    const writes = env
      .reads('/columns')
      .filter(({ method }) => method === 'POST');
    expect(writes.map(({ body }) => body)).toEqual([{ name: 'In progress' }]);
    rows = [{ ...column(1), name: 'In progress' }];
    await act(() => create.resolve(result(rows[0], 201)));
    await button('Column actions for In progress');
    await fireEvent(screen.getByTestId('board-columns'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 600 } },
    });
    await act(() =>
      renderList.mock.contexts
        .find((list) => list.props.horizontal)
        .props.onContentSizeChange(352, 600),
    );
    await waitFor(() =>
      expect(scrollToIndex).toHaveBeenCalledWith({ index: 0, animated: false }),
    );
  } finally {
    create.resolve(result(column(1), 201));
    await env.dispose();
    scrollToIndex.mockRestore();
    renderList.mockRestore();
  }
});

test('renames with a retained draft and moves using the current server order without clearing Card filters', async () => {
  let rows = [column(1), column(2), column(3)];
  let conflict = true;
  const env = await setup({
    board: writableBoard,
    cards: [card(1)],
    override(url, _session, request) {
      if (url.pathname.endsWith('/columns'))
        return response(page(rows, Number(url.searchParams.get('page')), 100));
      if (request.method !== 'PATCH') return null;
      if (url.pathname.endsWith('/move')) {
        const moved = { ...rows[1], position: '4.0000000000' };
        rows = [rows[0], rows[2], moved];
        return result(moved);
      }
      if (conflict) return columnError(409, 'CONFLICT');
      rows = rows.map((value) =>
        value.id === rows[1].id ? { ...value, name: request.body.name } : value,
      );
      return result(rows[1]);
    },
  });
  try {
    await screen.findByText('1 card');
    await fireEvent.press(await button('Due today'));
    await button('Filters (1)');
    await selectColumn('Column 1');
    expect(
      columnSheet().getByRole('button', { name: 'Move left' }).props
        .accessibilityState.disabled,
    ).toBe(true);
    await pressColumn('Rename column');
    expect(screen.getByLabelText('Column name').props.value).toBe('Column 1');
    rows[0] = { ...rows[0], name: 'Renamed on Web' };
    await act(() =>
      env.data.invalidate(env.data.getIdentity(), [
        queryKeys.columns(env.data.getIdentity(), boardId),
      ]),
    );
    await pressColumn('Save column');
    await waitFor(() =>
      expect(screen.queryByTestId('filter-modal')).toBeNull(),
    );
    expect(env.reads(`/${rows[0].id}`)).toHaveLength(0);
    await button('Column actions for Renamed on Web');

    await selectColumn('Column 2');
    await pressColumn('Rename column');
    await fireEvent.changeText(
      screen.getByLabelText('Column name'),
      '  Ready  ',
    );
    await pressColumn('Cancel');
    await screen.findByText('Discard changes?');
    await pressColumn('Keep editing');
    expect(screen.getByLabelText('Column name').props.value).toBe('  Ready  ');
    await pressColumn('Save column');
    await screen.findByText('Couldn’t save the column. Try again.');
    expect(screen.getByLabelText('Column name').props.value).toBe('  Ready  ');
    conflict = false;
    await pressColumn('Save column');
    await button('Column actions for Ready');
    await selectColumn('Ready');
    await pressColumn('Move right');
    await waitFor(() =>
      expect(screen.queryByTestId('filter-modal')).toBeNull(),
    );
    expect(env.reads('/move').map(({ body }) => body)).toEqual([
      { beforeColumnId: null },
    ]);
    const headings = screen
      .getAllByRole('header')
      .map(({ props }) => props.children);
    expect(headings.indexOf('Column 3')).toBeLessThan(
      headings.indexOf('Ready'),
    );
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeTruthy();
    expect(env.reads('/cards').at(-1).params.get('dueStatus')).toBe(
      'DUE_TODAY',
    );
  } finally {
    await env.dispose();
  }
});

test.each(['active', 'archived'])(
  'confirms deletion, preserves the Column on %s Card conflict, and handles a subsequent 204',
  async (status) => {
    const target = column(1);
    let rows = [target];
    let containsCard = true;
    let bodyRead = false;
    const env = await setup({
      board: writableBoard,
      override(url, _session, request) {
        if (url.pathname.endsWith('/columns'))
          return response(
            page(rows, Number(url.searchParams.get('page')), 100),
          );
        if (url.pathname.endsWith('/cards')) {
          const cards =
            containsCard && url.searchParams.get('status') === status
              ? [
                  {
                    ...card(1),
                    isArchived: status === 'archived',
                    archivedAt:
                      status === 'archived' ? boardDetail.createdAt : null,
                  },
                ]
              : [];
          return response(page(cards, 1, 100));
        }
        if (request.method !== 'DELETE') return null;
        if (containsCard) return columnError(409, 'COLUMN_NOT_EMPTY');
        rows = [];
        return {
          ...response(null, 204),
          text: async () => {
            bodyRead = true;
            throw new Error('Unexpected DELETE body read');
          },
        };
      },
    });
    try {
      await screen.findByText(status === 'active' ? '1 card' : '0 cards');
      await selectColumn(target.name);
      await pressColumn('Delete column');
      await screen.findByText(`Delete “${target.name}”?`);
      await fireEvent(screen.getByTestId('filter-modal'), 'touchEnd');
      expect(env.reads(`/${target.id}`)).toHaveLength(0);
      await selectColumn(target.name);
      await pressColumn('Delete column');
      await pressColumn('Delete column');
      await screen.findByText(
        'This column still contains active or archived cards.',
      );
      expect(screen.getByText(target.name)).toBeTruthy();
      const readsBeforeDelete = env.reads('/cards').length;
      containsCard = false;
      await pressColumn('Delete column');
      await screen.findByText('No columns yet');
      expect(bodyRead).toBe(false);
      expect(
        env.reads(`/${target.id}`).map(({ method, body }) => [method, body]),
      ).toEqual([
        ['DELETE', undefined],
        ['DELETE', undefined],
      ]);
      expect(env.reads('/cards').length).toBeGreaterThan(readsBeforeDelete);
    } finally {
      await env.dispose();
    }
  },
);

test('requires explicit review before retrying an uncertain POST and preserves the draft', async () => {
  const env = await setup({
    board: writableBoard,
    override(url, _session, request) {
      if (url.pathname.endsWith('/columns') && request.method === 'POST')
        return response({}, 503);
      return null;
    },
  });
  try {
    await button('Column actions for Column 1');
    await fireEvent.press(await button('Add column'));
    await fireEvent.changeText(
      screen.getByLabelText('Column name'),
      'Review later',
    );
    await pressColumn('Create column');
    await screen.findByText(
      'The server may have created this column. Check the refreshed board before creating again.',
    );
    expect(
      columnSheet().queryByRole('button', { name: 'Create column' }),
    ).toBeNull();
    await pressColumn('Review board');
    await fireEvent.press(await button('Add column'));
    expect(screen.getByLabelText('Column name').props.value).toBe(
      'Review later',
    );
    expect(
      env.reads('/columns').filter(({ method }) => method === 'POST'),
    ).toHaveLength(1);
    await pressColumn('I checked the board');
    expect(
      columnSheet().getByRole('button', { name: 'Create column' }),
    ).toBeTruthy();
  } finally {
    await env.dispose();
  }
});

test('an editable Column draft survives an offline access recheck', async () => {
  const env = await setup({ board: writableBoard });
  try {
    await button('Column actions for Column 1');
    await fireEvent.press(await button('Add column'));
    await fireEvent.changeText(
      screen.getByLabelText('Column name'),
      'Keep this draft',
    );
    await act(() => onlineManager.setOnline(false));
    await screen.findByText('Connection unavailable');
    expect(screen.queryByLabelText('Column name')).toBeNull();
    await act(() => onlineManager.setOnline(true));
    await screen.findByDisplayValue('Keep this draft');
    expect(
      env.reads('/columns').filter(({ method }) => method === 'POST'),
    ).toHaveLength(0);
  } finally {
    await env.dispose();
  }
});

test.each([
  ['reader', boardDetail],
  [
    'guest without write capability',
    {
      ...writableBoard,
      currentUserRole: 'MEMBER',
      capabilities: boardDetail.capabilities,
    },
  ],
  [
    'archived owner',
    { ...writableBoard, isArchived: true, archivedAt: boardDetail.createdAt },
  ],
])(
  '%s cannot access Column or Card mutation controls',
  async (_role, board) => {
    const env = await setup({ board, cards: [card(1)] });
    try {
      await button(/^Card 1,/);
      expect(screen.queryByRole('button', { name: 'Add column' })).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Column actions for Column 1' }),
      ).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add card' })).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Card actions for Card 1' }),
      ).toBeNull();
    } finally {
      await env.dispose();
    }
  },
);

test('filtered Kanban offers append only and does not insert a moved Card that the next server page omits', async () => {
  const source = card(1);
  let moved = false;
  const env = await setup({
    board: writableBoard,
    columns: [column(1), column(2)],
    override(url) {
      if (url.pathname.endsWith('/cards'))
        return response(page(moved ? [] : [source], 1, 100));
      if (url.pathname.endsWith(`/${source.id}`)) return result(source);
      if (url.pathname.endsWith('/move')) {
        moved = true;
        return result({ ...source, columnId: column(2).id });
      }
      return null;
    },
  });
  try {
    await fireEvent.press(await button('Due today'));
    await button('Filters (1)');
    await selectCard('Card 1');
    await pressColumn('Move to…');
    await screen.findByText(
      'Clear filters and sorting to choose a precise position.',
    );
    expect(screen.queryByRole('button', { name: 'Move up' })).toBeNull();
    await pressColumn('Column 2');
    await pressColumn('Move to end of column');
    await screen.findByText('No cards match these filters.');
    expect(
      env.reads('/cards').some(({ params }) => params.has('columnId')),
    ).toBe(false);
    expect(env.reads('/cards').at(-1).params.get('dueStatus')).toBe(
      'DUE_TODAY',
    );
    expect(env.reads('/move').at(-1).body).toEqual({
      toColumnId: column(2).id,
      beforeCardId: null,
    });
  } finally {
    await env.dispose();
  }
});

test('revocation closes a pending duplicate, drops its eventual result, and fences rapid repeats', async () => {
  const duplicate = deferred();
  const env = await setup({
    board: writableBoard,
    cards: [card(1)],
    override(url) {
      return url.pathname.endsWith('/duplicate') ? duplicate.promise : null;
    },
  });
  try {
    await selectCard('Card 1');
    await pressColumn('Duplicate');
    const action = columnSheet().getByRole('button', {
      name: 'Duplicate card',
    });
    await fireEvent.press(action);
    await fireEvent.press(action);
    await waitFor(() => expect(env.reads('/duplicate')).toHaveLength(1));
    await act(() => env.realtime.revokeBoard(boardId));
    await screen.findByText('Board unavailable');
    await act(() =>
      duplicate.resolve(result({ ...card(2), title: 'Private copy' }, 201)),
    );
    expect(screen.queryByTestId('filter-modal')).toBeNull();
    expect(screen.queryByText('Private copy')).toBeNull();
  } finally {
    duplicate.resolve(result(card(2), 201));
    await env.dispose();
  }
});

test('revocation during a Column write removes the editor and ignores a delayed success', async () => {
  const create = deferred();
  const env = await setup({
    board: writableBoard,
    override(url, _session, request) {
      return url.pathname.endsWith('/columns') && request.method === 'POST'
        ? create.promise
        : null;
    },
  });
  try {
    await button('Column actions for Column 1');
    await fireEvent.press(await button('Add column'));
    await fireEvent.changeText(
      screen.getByLabelText('Column name'),
      'Revoked draft',
    );
    await pressColumn('Create column');
    await screen.findByText('Saving column changes…');
    await act(() => env.realtime.revokeBoard(boardId));
    await screen.findByText('Board unavailable');
    await act(() =>
      create.resolve(result({ ...column(2), name: 'Revoked draft' }, 201)),
    );
    expect(screen.queryByText('Revoked draft')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add column' })).toBeNull();
  } finally {
    create.resolve(result(column(2), 201));
    await env.dispose();
  }
});

test.each([0, 1, 20, 100, 101, 251])(
  'Table reads %i real cards on demand with honest totals and bounded preview requests',
  async (count) => {
    const rows = Array.from({ length: count }, (_, index) => card(index + 1));
    const env = await setup({ cards: rows });
    try {
      await fireEvent.press(await screen.findByRole('tab', { name: 'Table' }));
      await screen.findByTestId('board-table');
      const pages = Math.max(1, Math.ceil(count / 100));
      for (let pageNumber = 1; pageNumber < pages; pageNumber++) {
        await screen.findByText(`Loaded ${pageNumber * 100} of ${count} cards`);
        expect(env.reads('/cards')).toHaveLength(pageNumber);
        await fireEvent.press(await button('Load more cards'));
      }
      await screen.findByText(`${count} ${count === 1 ? 'card' : 'cards'}`);
      expect(
        env
          .reads('/cards')
          .map(({ params }) => [params.get('page'), params.get('limit')]),
      ).toEqual(
        Array.from({ length: pages }, (_, index) => [String(index + 1), '100']),
      );
      await waitFor(() =>
        expect(env.reads('/card-preview-summaries')).toHaveLength(
          count ? pages : 0,
        ),
      );
      expect(
        env
          .reads('/card-preview-summaries')
          .every(
            ({ params }) => params.get('cardIds').split(',').length <= 100,
          ),
      ).toBe(true);
      if (count) {
        expect(await button('Open card: Card 1')).toBeTruthy();
        expect(screen.getAllByText('Column: Column 1').length).toBeGreaterThan(
          0,
        );
        expect(screen.getAllByText('Card 1')).toHaveLength(1);
        expect(
          screen.queryAllByText(/^Card [0-9]+$/).length,
        ).toBeLessThanOrEqual(Math.max(5, count));
      } else expect(screen.getByText('No cards to display')).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: /^Card actions for/ }),
      ).toBeNull();
      await fireEvent.press(screen.getByRole('button', { name: 'Calendar' }));
      expect(mockPush).toHaveBeenCalledWith(`/boards/${boardId}/calendar`);
      const readCount = env.reads('/cards').length;
      await fireEvent.press(screen.getByRole('tab', { name: 'Board' }));
      await screen.findByTestId('board-columns');
      await fireEvent.press(screen.getByRole('tab', { name: 'Table' }));
      expect(env.reads('/cards')).toHaveLength(readCount);
    } finally {
      await env.dispose();
    }
  },
);

test.each([
  ['Title A–Z', 'title', 'asc'],
  ['Title Z–A', 'title', 'desc'],
  ['Earliest due date', 'dueDate', 'asc'],
  ['Latest due date', 'dueDate', 'desc'],
])(
  'Table sort %s resets server pagination and preserves filters through Board and Back',
  async (label, sortBy, direction) => {
    const env = await setup({
      cards: Array.from({ length: 101 }, (_, i) => card(i + 1)),
    });
    try {
      await fireEvent.press(await screen.findByRole('tab', { name: 'Table' }));
      await screen.findByText('Loaded 100 of 101 cards');
      await fireEvent.press(await button('Load more cards'));
      await screen.findByText('101 cards');
      await fireEvent.press(await button('Sort: Board order'));
      await fireEvent.changeText(
        screen.getByLabelText('Search cards'),
        ' Card ',
      );
      await fireEvent.press(await button(label));
      await fireEvent.press(await button('Apply filters (2)'));
      await screen.findByText('Loaded 100 of 101 cards');
      const params = env.reads('/cards').at(-1).params;
      expect([
        params.get('q'),
        params.get('sortBy'),
        params.get('sortDirection'),
        params.get('page'),
      ]).toEqual(['Card', sortBy, direction, '1']);
      await fireEvent.press(await button('Load more cards'));
      await screen.findByText('101 cards');
      await fireEvent.press(await button('Open card: Card 1'));
      expect(mockPush).toHaveBeenLastCalledWith(
        `/boards/${boardId}/cards/${card(1).id}`,
      );
      await env.focus(false);
      await env.focus(true);
      await screen.findByTestId('board-table');
      await button(`Sort: ${label}`);
      await screen.findByText('101 cards');
      await fireEvent.press(screen.getByRole('tab', { name: 'Board' }));
      await button('Filters (2)');
      expect(
        screen.getByRole('tab', { name: 'Board' }).props.accessibilityState
          .selected,
      ).toBe(true);
      await fireEvent.press(await button('Filters (2)'));
      await fireEvent.changeText(
        screen.getByLabelText('Search cards'),
        'not applied',
      );
      await fireEvent.press(await button('Cancel'));
      expect(env.reads('/cards').at(-1).params.get('q')).toBe('Card');
      await fireEvent.press(await button('Filters (2)'));
      await fireEvent.press(await button('Reset'));
      await fireEvent.press(await button('Apply filters (0)'));
      await screen.findByText('Loaded 100 of 101 cards');
      expect(env.reads('/cards').at(-1).params.get('q')).toBeNull();
    } finally {
      await env.dispose();
    }
  },
);

test('Table tolerates roster denial and unknown labels, uses MOB-19 dates and fences a delayed preview on revoke', async () => {
  const slow = deferred();
  let delayed = false;
  const row = {
    ...card(1),
    dueDate: '2026-11-17T20:00:00.000Z',
    assignees: [{ userId: USER_A }],
  };
  const env = await setup({
    cards: [row],
    mode: 'dark',
    override(url) {
      if (url.pathname.endsWith('/members')) return response({}, 403);
      if (url.pathname.endsWith('/card-preview-summaries'))
        return delayed
          ? slow.promise
          : result({
              summaries: [{ ...preview(row.id), labelIds: [uuid(9999)] }],
            });
      return null;
    },
  });
  try {
    await fireEvent.press(await screen.findByRole('tab', { name: 'Table' }));
    await button('Open card: Card 1');
    await screen.findByText('1 unresolved label');
    await screen.findByText('1 assigned');
    expect(screen.queryByText('Mobile QA')).toBeNull();
    expect(screen.getByText('1/2 checklist items')).toBeTruthy();
    expect(screen.getByLabelText(/Wednesday, November 18, 2026/)).toBeTruthy();
    const identity = env.data.getIdentity();
    delayed = true;
    await act(() => {
      void env.data.invalidate(identity, [
        [...queryKeys.board(identity, boardId), 'previews'],
      ]);
    });
    await act(() => env.realtime.revokeBoard(boardId));
    await screen.findByText('Board unavailable');
    await act(() => slow.resolve(result({ summaries: [preview(row.id)] })));
    expect(screen.queryByTestId('board-table')).toBeNull();
    expect(screen.queryByText('Card 1')).toBeNull();
    expect(
      env.data.queryClient
        .getQueriesData({ queryKey: queryKeys.board(identity, boardId) })
        .every(([, value]) => value === undefined),
    ).toBe(true);
  } finally {
    slow.resolve(result({ summaries: [] }));
    await env.dispose();
  }
});

test('Table retries a failed next page and repairs an empty shifted last page after archive', async () => {
  const rows = Array.from({ length: 101 }, (_, i) => card(i + 1));
  let stage = 0;
  const env = await setup({
    cards: rows,
    override(url) {
      if (!url.pathname.endsWith('/cards')) return null;
      const n = Number(url.searchParams.get('page'));
      if (n === 2 && stage === 0) {
        stage = 1;
        return response({}, 500);
      }
      if (n === 2 && stage === 1) {
        stage = 2;
        return response(page(rows.slice(0, 100), n, 100));
      }
      if (stage === 2) return response(page(rows.slice(0, 100), n, 100));
      return null;
    },
  });
  try {
    await fireEvent.press(await screen.findByRole('tab', { name: 'Table' }));
    await screen.findByText('Loaded 100 of 101 cards');
    await fireEvent.press(await button('Load more cards'));
    await fireEvent.press(await button('Retry cards'));
    await screen.findByText('100 cards');
    expect(env.reads('/cards').map(({ params }) => params.get('page'))).toEqual(
      ['1', '2', '2', '1'],
    );
    expect(screen.queryByText('Loaded 100 of 101 cards')).toBeNull();
  } finally {
    await env.dispose();
  }
});

test.each(['logout', 'account', '401'])(
  'Table %s fences old rows, label catalog and late summary responses',
  async (kind) => {
    const slow = deferred();
    let delaying = false;
    let expired = false;
    const label = {
      id: uuid(8000),
      boardId,
      name: 'Private Table label',
      color: '#615CF7',
    };
    const env = await setup({
      cards: [card(1)],
      override(url, session) {
        if (session.user.id === USER_B) return response({}, 404);
        if (expired && url.pathname.endsWith('/cards'))
          return response({}, 401);
        if (url.pathname.endsWith('/labels'))
          return response(page([label], 1, 100));
        if (url.pathname.endsWith('/card-preview-summaries'))
          return delaying
            ? slow.promise
            : result({
                summaries: [{ ...preview(card(1).id), labelIds: [label.id] }],
              });
        return null;
      },
    });
    try {
      await fireEvent.press(await screen.findByRole('tab', { name: 'Table' }));
      await screen.findByText('Private Table label');
      const identity = env.data.getIdentity();
      delaying = true;
      await act(() => {
        void env.data
          .invalidate(identity, [
            [...queryKeys.board(identity, boardId), 'previews'],
          ])
          .catch((error) => expect(error.kind).toBe('session-changed'));
      });
      if (kind === 'logout') await act(() => env.manager.logout());
      else if (kind === 'account')
        await act(() => env.manager.establishSession(loginResponse(USER_B)));
      else {
        expired = true;
        await act(() =>
          env.data
            .invalidate(identity, [queryKeys.cards(identity, boardId)])
            .catch((error) => expect(error.kind).toBe('session-changed')),
        );
      }
      await act(() =>
        slow.resolve(
          result({
            summaries: [{ ...preview(card(1).id), labelIds: [label.id] }],
          }),
        ),
      );
      expect(screen.queryByTestId('board-table')).toBeNull();
      expect(screen.queryByText('Private Table label')).toBeNull();
      expect(screen.queryByText('Card 1')).toBeNull();
      expect(
        env.data.queryClient
          .getQueriesData({ queryKey: queryKeys.scope(identity) })
          .every(([, value]) => value === undefined),
      ).toBe(true);
    } finally {
      slow.resolve(result({ summaries: [] }));
      await env.dispose();
    }
  },
);

function images(node = screen.toJSON()) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((child) => images(child));
  return [
    ...(node.type === 'Image' ? [node] : []),
    ...(node.children ?? []).flatMap((child) => images(child)),
  ];
}

function memberRow(id, displayName, avatarUrl, avatarRevision = 0) {
  return {
    userId: id,
    role: 'MEMBER',
    user: { id, displayName, avatarUrl, avatarRevision },
  };
}

test('F03: managed assignee avatar paths render authorized photos; legacy HTTPS stays unauthenticated; malformed paths keep initials', async () => {
  const other = uuid(61);
  const legacy = uuid(62);
  const managed = `/users/${USER_B}/avatar/${uuid(77)}`;
  const env = await setup({
    cards: [
      { ...card(1), assignees: [{ userId: USER_B }] },
      { ...card(2), assignees: [{ userId: legacy }] },
      { ...card(3), assignees: [{ userId: other }] },
    ],
    override(url) {
      if (url.pathname.endsWith('/members'))
        return response(
          page(
            [
              memberRow(USER_B, 'Bea Photo', managed, 3),
              memberRow(legacy, 'Lee Legacy', 'https://images.example/l.png'),
              // Another user's managed path is never trusted for this user.
              memberRow(other, 'Oli Other', managed),
            ],
            1,
            100,
          ),
        );
      return null;
    },
  });
  const binary = jest
    .spyOn(env.data.api, 'binary')
    .mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]).buffer });
  try {
    await button(/^Card 1,/);
    await waitFor(() =>
      expect(images().map((image) => image.props.source?.uri)).toEqual(
        expect.arrayContaining([
          'data:image/webp;base64,AQID',
          'https://images.example/l.png',
        ]),
      ),
    );
    expect(binary).toHaveBeenCalledTimes(1);
    expect(binary).toHaveBeenCalledWith(
      managed,
      ['image/webp'],
      expect.objectContaining({
        identity: env.data.getIdentity(),
        resourceKey: [
          ...queryKeys.members(env.data.getIdentity(), boardId),
          'avatar',
          USER_B,
          3,
          managed,
        ],
      }),
    );
    expect(images().filter((image) => image.props.source?.uri)).toHaveLength(2);
    // Logout clears every photo with the session.
    await act(() => env.manager.logout());
    expect(images()).toHaveLength(0);
  } finally {
    binary.mockRestore();
    await env.dispose();
  }
});

test('F04: background Board revalidation keeps an open filter sheet and its unapplied draft without showing it while unverified', async () => {
  const slow = deferred();
  let hold = false;
  const env = await setup({
    cards: [card(1), { ...card(2), title: 'Search hit' }],
    override(url) {
      if (url.pathname === `/api/boards/${boardId}` && hold)
        return slow.promise;
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
    // An unrelated member addition triggers a background detail refetch.
    hold = true;
    await act(() => {
      void env.data.queryClient.invalidateQueries({
        queryKey: queryKeys.board(env.data.getIdentity(), boardId),
        exact: true,
      });
    });
    await waitFor(() =>
      expect(screen.queryByLabelText('Search cards')).toBeNull(),
    );
    expect(screen.queryByText('Card 1')).toBeNull();
    hold = false;
    await act(async () => slow.resolve(result(boardDetail)));
    const search = await screen.findByLabelText('Search cards');
    expect(search.props.value).toBe(' Search ');
    // The draft is still unapplied: no filtered read happened.
    expect(env.reads('/cards').every(({ params }) => !params.get('q'))).toBe(
      true,
    );
    await fireEvent.press(await button('Apply filters (1)'));
    await button(/^Search hit,/);
    expect(env.reads('/cards').at(-1).params.get('q')).toBe('Search');
  } finally {
    await env.dispose();
  }
});

test('F04: confirmed access loss discards the protected draft and never restores it', async () => {
  let allowed = true;
  const env = await setup({
    cards: [card(1)],
    override(url) {
      if (url.pathname === `/api/boards/${boardId}` && !allowed)
        return response({}, 404);
      return null;
    },
  });
  try {
    await screen.findByText('1 card');
    await fireEvent.press(await button('Filters'));
    await fireEvent.changeText(screen.getByLabelText('Search cards'), 'Secret');
    allowed = false;
    await act(() =>
      env.data.queryClient.invalidateQueries({
        queryKey: queryKeys.board(env.data.getIdentity(), boardId),
        exact: true,
      }),
    );
    await screen.findByText('Board unavailable');
    expect(screen.queryByLabelText('Search cards')).toBeNull();
    allowed = true;
    await env.focus(false);
    await env.focus(true);
    await act(() =>
      env.data.queryClient.invalidateQueries({
        queryKey: queryKeys.board(env.data.getIdentity(), boardId),
        exact: true,
      }),
    );
    await screen.findByText('1 card');
    expect(screen.queryByLabelText('Search cards')).toBeNull();
    await fireEvent.press(await button('Filters'));
    expect(screen.getByLabelText('Search cards').props.value).toBe('');
  } finally {
    await env.dispose();
  }
});

test('F03: roster denial never reads a private photo; a new revision replaces the cached one', async () => {
  const managed = `/users/${USER_B}/avatar/${uuid(77)}`;
  let roster = 'denied';
  let revision = 1;
  const env = await setup({
    cards: [{ ...card(1), assignees: [{ userId: USER_B }] }],
    override(url) {
      if (url.pathname.endsWith('/members'))
        return roster === 'denied'
          ? response({}, 403)
          : response(
              page([memberRow(USER_B, 'Bea Photo', managed, revision)], 1, 100),
            );
      return null;
    },
  });
  const binary = jest
    .spyOn(env.data.api, 'binary')
    .mockImplementation(async () => ({
      bytes: new Uint8Array([revision]).buffer,
    }));
  try {
    await button(/^Card 1,/);
    await waitFor(() =>
      expect(env.reads('/members').length).toBeGreaterThan(0),
    );
    expect(binary).not.toHaveBeenCalled();
    expect(images().filter((image) => image.props.source?.uri)).toHaveLength(0);
    roster = 'allowed';
    const members = queryKeys.members(env.data.getIdentity(), boardId);
    await act(() =>
      env.data.queryClient.resetQueries({ queryKey: members, exact: true }),
    );
    await waitFor(() =>
      expect(images().map((image) => image.props.source?.uri)).toContain(
        'data:image/webp;base64,AQ==',
      ),
    );
    revision = 2;
    await act(() =>
      env.data.queryClient.resetQueries({ queryKey: members, exact: true }),
    );
    await waitFor(() =>
      expect(images().map((image) => image.props.source?.uri)).toContain(
        'data:image/webp;base64,Ag==',
      ),
    );
    expect(binary).toHaveBeenCalledTimes(2);
    expect(
      binary.mock.calls.map(([, , options]) => options.resourceKey.at(-2)),
    ).toEqual([1, 2]);
  } finally {
    binary.mockRestore();
    await env.dispose();
  }
});
