/* global jest, test, expect */
import { URL } from 'node:url';
import { AppState, FlatList, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { phoneMetrics } from './render-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';
import CalendarRoute from '../src/app/(private)/boards/[boardId]/calendar';
import { MonthGrid } from '../src/features/calendar/MonthGrid';
import { BoardViewFiltersProvider } from '../src/features/boards/BoardViewFilters';
import { createHttpClient } from '../src/infrastructure/api/client';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { createSessionManager } from '../src/infrastructure/auth/session-manager';
import { createCredentialStore } from '../src/infrastructure/auth/credential-store';
import { createMobileDataLayer } from '../src/infrastructure/query/data-layer';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { queryKeys } from '../src/infrastructure/query/keys';
import { createNativeRealtime } from '../src/infrastructure/realtime/client';
import { RealtimeProvider } from '../src/infrastructure/realtime/RealtimeProvider';
import { ThemeContext, palettes } from '../src/ui';
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
  cardDto,
  boardId,
  boardDetail,
  preview,
} from './workspaces/kanban-fixtures';
import { page } from './workspaces/fixtures';

const mockRouter = {
  push: jest.fn(),
  back: jest.fn(),
  replace: jest.fn(),
  canGoBack: () => true,
};
let mockFocus = true;
let mockDimensions = { width: 320, height: 700, scale: 3, fontScale: 1.6 };
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => mockRouter,
  usePathname: () => '/boards/00000000-0000-4000-8000-0000000003e9/calendar',
  useIsFocused: () => mockFocus,
  useLocalSearchParams: () => ({
    boardId: '00000000-0000-4000-8000-0000000003e9',
  }),
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  const descriptors = Object.getOwnPropertyDescriptors(native);
  descriptors.useWindowDimensions = {
    configurable: true,
    enumerable: true,
    value: () => mockDimensions,
  };
  descriptors.useColorScheme = {
    configurable: true,
    enumerable: true,
    value: () => 'dark',
  };
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
const result = (data) =>
  response({ success: true, statusCode: 200, message: 'OK', data });
const dated = (n, dueDate = '2026-11-17T09:00:00.000Z') => ({
  ...cardDto(n),
  dueDate,
});

async function setup({
  cards = [dated(1)],
  preferences = {
    timeZone: 'Asia/Bangkok',
    weekStartsOn: 'monday',
    dateFormat: 'DD/MM/YYYY',
    theme: 'light',
  },
  override,
  board = boardDetail,
} = {}) {
  mockFocus = true;
  mockRouter.push.mockClear();
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
  const fetch = async (input, init) => {
    const url = new URL(input);
    requests.push({ url, init });
    const custom = override?.(url, manager.getSnapshot(), init);
    if (custom) return custom;
    const n = Number(url.searchParams.get('page'));
    if (url.pathname.endsWith('/preferences')) return result(preferences);
    if (url.pathname === `/api/boards/${boardId}`) return result(board);
    if (url.pathname.endsWith('/columns'))
      return response(page([column(1)], n, 100));
    if (url.pathname.endsWith('/cards')) {
      const q = url.searchParams.get('q');
      return response(
        page(
          cards.filter((card) => !q || card.title.includes(q)),
          n,
          100,
        ),
      );
    }
    if (url.pathname.endsWith('/card-preview-summaries'))
      return result({
        summaries: url.searchParams.get('cardIds').split(',').map(preview),
      });
    if (url.pathname.endsWith('/labels') || url.pathname.endsWith('/members'))
      return response(page([], n, 100));
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
  let routeMounted = true;
  const tree = () => (
    <SafeAreaProvider initialMetrics={phoneMetrics}>
      <SessionProvider manager={manager}>
        <DataProvider layer={data}>
          <RealtimeProvider client={realtime}>
            <BoardViewFiltersProvider>
              {routeMounted && <CalendarRoute />}
            </BoardViewFiltersProvider>
          </RealtimeProvider>
        </DataProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
  const mounted = await render(tree());
  return {
    data,
    manager,
    realtime,
    requests,
    cards,
    preferences,
    remountRoute: async () => {
      routeMounted = false;
      await mounted.rerender(tree());
      routeMounted = true;
      await mounted.rerender(tree());
    },
    focus: async (value) => {
      mockFocus = value;
      await mounted.rerender(tree());
    },
    dispose: async () => {
      await mounted.unmount();
      realtime.dispose();
      data.dispose();
      manager.dispose();
      onlineManager.setOnline(true);
    },
  };
}
const pick = async (day) =>
  fireEvent.press(await screen.findByTestId(`calendar-day-${day}`));
const openCard = () =>
  screen.findByRole('button', { name: 'Open card: Card 1' }, { timeout: 5000 });

// Clock is deterministic without faking Query's scheduler.
const clock = () =>
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-17T00:00:00Z'));

test('real Month route, due-only counts, selected day, canonical Card push and focus/back retention', async () => {
  const now = clock();
  const env = await setup({
    cards: [
      dated(1),
      { ...cardDto(2), startDate: '2026-11-17T09:00:00.000Z' },
      cardDto(3),
    ],
  });
  try {
    await openCard();
    expect(screen.getByText('1 Card')).toBeTruthy();
    expect(screen.getByText('17/11/2026 · 16:00')).toBeTruthy();
    expect(screen.queryByText('Card 2')).toBeNull();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Next month' }),
    );
    expect(screen.getByText('December 2026')).toBeTruthy();
    await pick('2026-12-18');
    await env.focus(false);
    await env.focus(true);
    await waitFor(() =>
      expect(
        screen.getByTestId('calendar-day-2026-12-18').props.accessibilityLabel,
      ).not.toContain('counts unavailable'),
    );
    await screen.findByText('December 2026');
    expect(
      screen.getByTestId('calendar-day-2026-12-18').props.accessibilityState
        .selected,
    ).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Today' }));
    await fireEvent.press(await openCard());
    expect(mockRouter.push).toHaveBeenCalledWith(
      `/boards/${boardId}/cards/${dated(1).id}`,
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Week' }));
    expect(
      screen.getByRole('radio', { name: 'Week' }).props.accessibilityState
        .checked,
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Next week' })).toBeTruthy();
  } finally {
    await env.dispose();
    now.mockRestore();
  }
});

test('all 251 Cards load before any day count, final-page failure stays incomplete and retries', async () => {
  const now = clock();
  const gate = deferred();
  let fail = true;
  const rows = Array.from({ length: 251 }, (_, n) => dated(n + 1));
  const env = await setup({
    cards: rows,
    override(url) {
      if (
        url.pathname.endsWith('/cards') &&
        url.searchParams.get('page') === '3'
      )
        return fail ? gate.promise : null;
      return null;
    },
  });
  try {
    await screen.findByText(/Loading complete calendar/);
    expect(screen.queryByText('251 Cards')).toBeNull();
    expect(
      screen.getByTestId('calendar-day-2026-11-17').props.accessibilityLabel,
    ).toContain('counts unavailable');
    await act(() => gate.resolve(response({}, 500)));
    await screen.findByText('Calendar incomplete');
    expect(
      screen.queryByRole('button', { name: 'Open card: Card 1' }),
    ).toBeNull();
    fail = false;
    await fireEvent.press(
      screen.getByRole('button', { name: 'Retry calendar' }),
    );
    await screen.findByText('251 Cards');
    expect(
      screen.getByTestId('calendar-day-2026-11-17').props.accessibilityLabel,
    ).toContain('251 due Cards');
    const pages = env.requests
      .filter(({ url }) => url.pathname.endsWith('/cards'))
      .map(({ url }) => url.searchParams.get('page'));
    expect(pages).toEqual(['1', '2', '3', '1', '2', '3', '1']);
  } finally {
    await env.dispose();
    now.mockRestore();
  }
});

test('Calendar filters reuse Apply/Reset, search and Column; Android Back dismisses without applying', async () => {
  const now = clock();
  const env = await setup();
  try {
    await openCard();
    await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.queryByText('View archived cards')).toBeNull();
    expect(screen.queryByText('Due from (inclusive)')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Search cards'), 'Card 1');
    await fireEvent.press(screen.getByRole('button', { name: 'Column 1' }));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Apply filters (2)' }),
    );
    await screen.findByRole('button', { name: 'Filters (2)' });
    await openCard();
    const last = env.requests
      .filter(({ url }) => url.pathname.endsWith('/cards'))
      .at(-1).url;
    expect(last.searchParams.get('q')).toBe('Card 1');
    expect(last.searchParams.get('columnId')).toBe(column(1).id);
    expect(last.searchParams.get('status')).toBe('active');
    await fireEvent.press(screen.getByRole('button', { name: 'Filters (2)' }));
    await fireEvent.changeText(
      screen.getByLabelText('Search cards'),
      'discard',
    );
    await fireEvent(screen.getByTestId('filter-modal'), 'touchEnd');
    expect(screen.queryByText('Calendar filters')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Filters (2)' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Reset' }));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Apply filters (0)' }),
    );
    await screen.findByRole('button', { name: 'Filters' });
    await openCard();
    expect(
      env.requests
        .filter(({ url }) => url.pathname.endsWith('/cards'))
        .at(-1)
        .url.searchParams.has('q'),
    ).toBe(false);
  } finally {
    await env.dispose();
    now.mockRestore();
  }
});

test('Board revoke purges titles/counts; delayed Card page cannot resurrect protected data', async () => {
  const now = clock();
  const gate = deferred();
  let delayed = false;
  const env = await setup({
    override(url) {
      return delayed && url.pathname.endsWith('/cards') ? gate.promise : null;
    },
  });
  try {
    await openCard();
    await switchView('Week');
    delayed = true;
    await act(() => {
      void env.data.queryClient.invalidateQueries({
        queryKey: queryKeys.cards(env.data.getIdentity(), boardId),
      });
    });
    await act(() => env.realtime.revokeBoard(boardId));
    expect(screen.queryByText('Card 1')).toBeNull();
    expect(screen.queryByText('1 Card')).toBeNull();
    await act(() => gate.resolve(response(page([dated(1)], 1, 100))));
    expect(screen.queryByText('Card 1')).toBeNull();
    expect(screen.queryByText(boardDetail.name)).toBeNull();
  } finally {
    await env.dispose();
    now.mockRestore();
  }
});

test('account switch and logout never retain old-account Card data', async () => {
  const now = clock();
  const env = await setup({
    override(url, session) {
      return session.status === 'authenticated' &&
        session.user.id === USER_B &&
        url.pathname.endsWith('/cards')
        ? response(page([], 1, 100))
        : null;
    },
  });
  try {
    await openCard();
    await switchView('Week');
    await act(() => env.manager.establishSession(loginResponse(USER_B)));
    expect(screen.queryByText('Card 1')).toBeNull();
    await screen.findByText('No Cards due this day');
    await act(() => env.manager.logout());
    expect(screen.queryByText('Card 1')).toBeNull();
  } finally {
    await env.dispose();
    now.mockRestore();
  }
});

test('saved timezone/date/week/theme preferences regroup without changing due instant', async () => {
  const now = clock();
  const preferences = {
    timeZone: 'UTC',
    weekStartsOn: 'monday',
    dateFormat: 'YYYY-MM-DD',
    theme: 'dark',
  };
  const env = await setup({
    cards: [dated(1, '2026-11-17T00:30:00.000Z')],
    preferences,
  });
  try {
    await openCard();
    preferences.timeZone = 'America/Los_Angeles';
    preferences.weekStartsOn = 'sunday';
    preferences.dateFormat = 'MM/DD/YYYY';
    await act(() =>
      env.data.queryClient.invalidateQueries({
        queryKey: queryKeys.datePreferences(env.data.getIdentity()),
      }),
    );
    await pick('2026-11-16');
    await openCard();
    expect(screen.getByText('11/16/2026 · 16:30')).toBeTruthy();
    expect(env.cards[0].dueDate).toBe('2026-11-17T00:30:00.000Z');
    expect(
      StyleSheet.flatten(
        screen.getByRole('button', { name: 'Open card: Card 1' }).props.style,
      ).backgroundColor,
    ).toBe(palettes.dark.surface);
  } finally {
    await env.dispose();
    now.mockRestore();
  }
});

test('320dp/160% grid labels, selected state, bounded counts and light/dark tokens', async () => {
  const select = jest.fn();
  const props = {
    selected: '2026-11-17',
    today: '2026-11-17',
    weekStartsOn: 'monday',
    counts: new Map([['2026-11-17', 250]]),
    onSelect: select,
    onPrevious: jest.fn(),
    onNext: jest.fn(),
    onToday: jest.fn(),
  };
  const mounted = await render(
    <ThemeContext.Provider value="system">
      <MonthGrid {...props} />
    </ThemeContext.Provider>,
  );
  const chosen = screen.getByTestId('calendar-day-2026-11-17');
  expect(chosen.props.accessibilityLabel).toContain(
    '250 due Cards, Today, selected',
  );
  expect(StyleSheet.flatten(chosen.props.style).minHeight).toBe(
    76.80000000000001,
  );
  expect(StyleSheet.flatten(chosen.props.style).backgroundColor).toBe(
    palettes.dark.primary,
  );
  expect(screen.getByText('99+', { includeHiddenElements: true })).toBeTruthy();
  await fireEvent.press(screen.getByTestId('calendar-day-2026-11-18'));
  expect(select).toHaveBeenCalledWith('2026-11-18');
  await mounted.rerender(
    <ThemeContext.Provider value="light">
      <MonthGrid {...props} />
    </ThemeContext.Provider>,
  );
  expect(
    StyleSheet.flatten(
      screen.getByTestId('calendar-day-2026-11-17').props.style,
    ).backgroundColor,
  ).toBe(palettes.light.primary);
});

test('Today resamples foreground clock and removes timer/listener on unmount', async () => {
  const now = clock();
  let listener;
  const remove = jest.fn();
  const originalSubscribe = AppState.addEventListener.getMockImplementation();
  const native = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_, callback) => {
      listener = callback;
      return { remove };
    });
  const env = await setup();
  try {
    await openCard();
    now.mockReturnValue(Date.parse('2026-11-18T00:00:00Z'));
    await act(() => listener('active'));
    await fireEvent.press(screen.getByRole('button', { name: 'Today' }));
    expect(
      screen.getByTestId('calendar-day-2026-11-18').props.accessibilityState
        .selected,
    ).toBe(true);
  } finally {
    await env.dispose();
    expect(remove).toHaveBeenCalled();
    native.mockImplementation(originalSubscribe);
    now.mockRestore();
  }
});

test('offline hides cached titles/counts, foreground reconnect reloads authorized data', async () => {
  const now = clock();
  const env = await setup();
  try {
    await openCard();
    await switchView('Week');
    await act(() => onlineManager.setOnline(false));
    expect(screen.queryByText('Card 1')).toBeNull();
    expect(screen.queryByText('1 Card')).toBeNull();
    expect(screen.getByText('Connection unavailable')).toBeTruthy();
    await act(() => onlineManager.setOnline(true));
    await openCard();
  } finally {
    await env.dispose();
    now.mockRestore();
  }
});

test('archived Board is readable without mutation affordances; denied catalogs do not hide Cards or infer metadata', async () => {
  const now = clock();
  const env = await setup({
    board: { ...boardDetail, isArchived: true },
    override(url) {
      if (url.pathname.endsWith('/labels') || url.pathname.endsWith('/members'))
        return response({}, 403);
      return null;
    },
  });
  try {
    await openCard();
    expect(screen.getByText('Archived Board · Read-only')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /Edit|Archive card|Delete/ }),
    ).toBeNull();
    expect(screen.queryByText(/Assigned to/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByLabelText('Search cards')).toBeTruthy();
  } finally {
    await env.dispose();
    now.mockRestore();
  }
});

test('scroll offset survives a Board recheck that remounts the native list', async () => {
  const now = clock();
  const rendered = jest.spyOn(FlatList.prototype, 'render');
  const scrollTo = jest
    .spyOn(FlatList.prototype, 'scrollToOffset')
    .mockImplementation(() => {});
  const env = await setup();
  try {
    await openCard();
    let list = rendered.mock.contexts
      .filter((item) => item.props.testID === 'calendar-agenda')
      .at(-1);
    await act(() => {
      list.props.onLayout({ nativeEvent: { layout: { height: 700 } } });
      list.props.onContentSizeChange(320, 1600);
      list.props.onScrollBeginDrag();
      list.props.onScroll({ nativeEvent: { contentOffset: { y: 500 } } });
    });
    await env.focus(false);
    await env.focus(true);
    await openCard();
    list = rendered.mock.contexts
      .filter((item) => item.props.testID === 'calendar-agenda')
      .at(-1);
    await act(() => {
      list.props.onLayout({ nativeEvent: { layout: { height: 700 } } });
      list.props.onContentSizeChange(320, 1600);
    });
    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith({ offset: 500, animated: false }),
    );
  } finally {
    await env.dispose();
    rendered.mockRestore();
    scrollTo.mockRestore();
    now.mockRestore();
  }
});

test('saved timezone update refetches server dueStatus membership, retaining explicit selected day', async () => {
  const now = clock();
  const env = await setup();
  try {
    await openCard();
    await switchView('Week');
    await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Due today' }));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Apply filters (1)' }),
    );
    await openCard();
    await pick('2026-11-17');
    const before = env.requests.filter(({ url }) =>
      url.pathname.endsWith('/cards'),
    ).length;
    env.preferences.timeZone = 'America/Los_Angeles';
    await act(() =>
      env.data.queryClient.invalidateQueries({
        queryKey: queryKeys.datePreferences(env.data.getIdentity()),
      }),
    );
    await waitFor(() =>
      expect(
        env.requests.filter(({ url }) => url.pathname.endsWith('/cards'))
          .length,
      ).toBeGreaterThan(before),
    );
    expect(
      screen.getByTestId('calendar-day-2026-11-17').props.accessibilityState
        .selected,
    ).toBe(true);
  } finally {
    await env.dispose();
    now.mockRestore();
  }
});

test('failed preferences disclose UTC fallback and allow explicit retry without fake zero counts', async () => {
  const now = clock();
  let fail = true;
  const env = await setup({
    override(url) {
      return fail && url.pathname.endsWith('/preferences')
        ? response({}, 503)
        : null;
    },
  });
  try {
    await openCard();
    expect(screen.getByText(/Using UTC, Monday first/)).toBeTruthy();
    expect(screen.getByText('2026-11-17 · 09:00')).toBeTruthy();
    fail = false;
    await fireEvent.press(
      screen.getByRole('button', { name: 'Retry date preferences' }),
    );
    await screen.findByText('17/11/2026 · 16:00');
    expect(screen.queryByText(/Using UTC, Monday first/)).toBeNull();
  } finally {
    await env.dispose();
    now.mockRestore();
  }
});

test.each([false, true])(
  'Card return pins originating day across account-zone midnight (explicit=%s)',
  async (explicit) => {
    const now = clock();
    now.mockReturnValue(Date.parse('2026-11-30T16:59:00Z'));
    const env = await setup({ cards: [dated(1, '2026-11-30T09:00:00.000Z')] });
    try {
      await openCard();
      if (explicit) await pick('2026-11-30');
      await fireEvent.press(await openCard());
      expect(mockRouter.push).toHaveBeenCalledWith(
        `/boards/${boardId}/cards/${dated(1).id}`,
      );
      await env.focus(false);
      now.mockReturnValue(Date.parse('2026-11-30T17:01:00Z'));
      await env.focus(true);
      await act(() => AppState.addEventListener.mock.calls.at(-1)[1]('active'));
      await waitFor(() =>
        expect(
          screen.getByTestId('calendar-day-2026-11-30').props.accessibilityState
            .selected,
        ).toBe(true),
      );
      await openCard();
      expect(screen.getByText('November 2026')).toBeTruthy();
      expect(
        screen.getByTestId('calendar-day-2026-11-30').props.accessibilityState
          .selected,
      ).toBe(true);
      await fireEvent.press(screen.getByRole('button', { name: 'Today' }));
      expect(screen.getByText('December 2026')).toBeTruthy();
      expect(
        screen.getByTestId('calendar-day-2026-12-01').props.accessibilityState
          .selected,
      ).toBe(true);
    } finally {
      await env.dispose();
      now.mockRestore();
    }
  },
);

test('zone change cancels initial DUE_TODAY walk before accepting new-zone membership', async () => {
  const now = clock();
  const gate = deferred();
  let firstSignal;
  let filteredReads = 0;
  const fresh = {
    ...dated(2, '2026-11-17T12:00:00.000Z'),
    title: 'New-zone deadline',
  };
  const env = await setup({
    preferences: {
      timeZone: 'UTC',
      dateFormat: 'YYYY-MM-DD',
      weekStartsOn: 'monday',
      theme: 'light',
    },
    override(url, _, init) {
      if (
        !url.pathname.endsWith('/cards') ||
        url.searchParams.get('dueStatus') !== 'DUE_TODAY'
      )
        return null;
      filteredReads++;
      if (filteredReads === 1) {
        firstSignal = init.signal;
        return gate.promise;
      }
      return response(page([fresh], 1, 100));
    },
  });
  try {
    await openCard();
    await pick('2026-11-17');
    await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Due today' }));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Apply filters (1)' }),
    );
    await waitFor(() => expect(filteredReads).toBe(1));
    expect(screen.queryByText('1 Card')).toBeNull();
    env.preferences.timeZone = 'America/Los_Angeles';
    await act(() =>
      env.data.queryClient.invalidateQueries({
        queryKey: queryKeys.datePreferences(env.data.getIdentity()),
      }),
    );
    // The previous-zone response is deliberately still unresolved here.
    await waitFor(() => expect(filteredReads).toBe(2));
    expect(firstSignal.aborted).toBe(true);
    await screen.findByRole('button', { name: 'Open card: New-zone deadline' });
    expect(screen.getByText('2026-11-17 · 04:00')).toBeTruthy();
    await act(() =>
      gate.resolve(
        response(page([dated(1, '2026-11-17T00:30:00.000Z')], 1, 100)),
      ),
    );
    expect(screen.queryByText('Card 1')).toBeNull();
    expect(
      screen.getByTestId('calendar-day-2026-11-17').props.accessibilityLabel,
    ).toContain('1 due Card');
    expect(filteredReads).toBe(2);
  } finally {
    gate.resolve(response(page([], 1, 100)));
    await env.dispose();
    now.mockRestore();
  }
});

test.each([320, 390, 768])(
  'Week strip %sdp: seven dates, exact bounded counts, focus and selected reveal at 160%% font',
  async (width) => {
    mockDimensions = { width, height: 700, scale: 3, fontScale: 1.6 };
    const scrollTo = jest
      .spyOn(ScrollView.prototype, 'scrollTo')
      .mockImplementation(() => {});
    const props = {
      view: 'week',
      onViewChange: jest.fn(),
      selected: '2027-01-03',
      today: '2026-12-30',
      weekStartsOn: 'monday',
      counts: new Map([['2027-01-03', 351]]),
      onSelect: jest.fn(),
      onPrevious: jest.fn(),
      onNext: jest.fn(),
      onToday: jest.fn(),
    };
    try {
      const mounted = await render(
        <ThemeContext.Provider value="system">
          <MonthGrid {...props} />
        </ThemeContext.Provider>,
      );
      expect(screen.getAllByTestId(/^calendar-day-/)).toHaveLength(7);
      expect(
        screen.getByText('28 Dec 2026 – 3 Jan 2027').props.numberOfLines,
      ).toBeUndefined();
      const selected = screen.getByTestId('calendar-day-2027-01-03');
      expect(selected.props.accessibilityLabel).toContain(
        '351 due Cards, selected',
      );
      expect(
        screen.getByText('99+', { includeHiddenElements: true }),
      ).toBeTruthy();
      expect(
        StyleSheet.flatten(selected.props.style).minHeight,
      ).toBeGreaterThanOrEqual(48);
      await fireEvent(selected, 'focus');
      expect(
        StyleSheet.flatten(
          screen.getByTestId('calendar-day-2027-01-03').props.style,
        ).borderColor,
      ).toBe(palettes.dark.focus);
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ animated: false }),
      );
      await mounted.rerender(
        <ThemeContext.Provider value="light">
          <MonthGrid {...props} counts={undefined} />
        </ThemeContext.Provider>,
      );
      expect(
        screen.getByTestId('calendar-day-2027-01-03').props.accessibilityLabel,
      ).toContain('counts unavailable');
      expect(
        screen.queryByText('99+', { includeHiddenElements: true }),
      ).toBeNull();
      expect(
        StyleSheet.flatten(
          screen.getByTestId('calendar-day-2027-01-03').props.style,
        ).backgroundColor,
      ).toBe(palettes.light.primary);
    } finally {
      scrollTo.mockRestore();
      mockDimensions = { width: 320, height: 700, scale: 3, fontScale: 1.6 };
    }
  },
);

const switchView = async (name) =>
  fireEvent.press(screen.getByRole('radio', { name }));
const cardReads = (env) =>
  env.requests.filter(({ url }) => url.pathname.endsWith('/cards'));

test.each([0, 1, 20, 21, 100, 101, 251, 351])(
  'Month/Week exact ID/order/count parity for %s Cards with no view-switch GETs',
  async (size) => {
    const now = clock();
    const rendered = jest.spyOn(FlatList.prototype, 'render');
    const rows = Array.from({ length: size }, (_, n) =>
      dated(
        n + 1,
        n % 2 ? '2026-11-17T10:00:00.000Z' : '2026-11-17T09:00:00.000Z',
      ),
    ).reverse();
    const expected = [...rows]
      .sort(
        (a, b) =>
          Date.parse(a.dueDate) - Date.parse(b.dueDate) ||
          a.id.localeCompare(b.id),
      )
      .map(({ id }) => id);
    const env = await setup({ cards: rows });
    const listIds = () =>
      rendered.mock.contexts
        .filter((item) => item.props.testID === 'calendar-agenda')
        .at(-1)
        .props.data.map(({ id }) => id);
    try {
      await screen.findByText(`${size} ${size === 1 ? 'Card' : 'Cards'}`);
      expect(listIds()).toEqual(expected);
      const before = env.requests.length;
      const pages = cardReads(env).map(({ url }) =>
        url.searchParams.get('page'),
      );
      expect(pages).toEqual(
        size <= 100
          ? ['1']
          : size <= 200
            ? ['1', '2', '1']
            : size <= 300
              ? ['1', '2', '3', '1']
              : ['1', '2', '3', '4', '1'],
      );
      for (const name of ['Week', 'Month', 'Week', 'Month']) {
        await switchView(name);
        expect(listIds()).toEqual(expected);
        expect(
          screen.getByTestId('calendar-day-2026-11-17').props
            .accessibilityLabel,
        ).toContain(`${size} due`);
        expect(
          screen.getByTestId('calendar-day-2026-11-17').props.accessibilityState
            .selected,
        ).toBe(true);
      }
      expect(env.requests.length).toBe(before);
    } finally {
      await env.dispose();
      rendered.mockRestore();
      now.mockRestore();
    }
  },
);

test('view switching during sequential pagination keeps one walk, unavailable counts and no duplicate requests', async () => {
  const now = clock();
  const gate = deferred();
  const rows = Array.from({ length: 101 }, (_, n) => dated(n + 1));
  let delayedSignal;
  const env = await setup({
    cards: rows,
    override(url, _, init) {
      if (
        url.pathname.endsWith('/cards') &&
        url.searchParams.get('page') === '2'
      ) {
        delayedSignal = init.signal;
        return gate.promise;
      }
      return null;
    },
  });
  try {
    await waitFor(() => expect(cardReads(env)).toHaveLength(2));
    for (const name of ['Week', 'Month', 'Week']) {
      await switchView(name);
      expect(
        screen.getByTestId('calendar-day-2026-11-17').props.accessibilityLabel,
      ).toContain('counts unavailable');
    }
    expect(cardReads(env)).toHaveLength(2);
    expect(delayedSignal.aborted).toBe(false);
    await act(() => gate.resolve(response(page(rows, 2, 100))));
    await screen.findByText('101 Cards');
    expect(
      cardReads(env).map(({ url }) => url.searchParams.get('page')),
    ).toEqual(['1', '2', '1']);
    expect(screen.getAllByTestId(/^calendar-day-/)).toHaveLength(7);
  } finally {
    gate.resolve(response(page(rows, 2, 100)));
    await env.dispose();
    now.mockRestore();
  }
});

test('Week +/-7, cross-month switch, filter Apply/Reset and Card return after full route unmount retain state/scroll', async () => {
  const now = clock();
  const rendered = jest.spyOn(FlatList.prototype, 'render');
  const scrollTo = jest
    .spyOn(FlatList.prototype, 'scrollToOffset')
    .mockImplementation(() => {});
  const env = await setup({ cards: [dated(1, '2026-12-02T09:00:00.000Z')] });
  const currentList = () =>
    rendered.mock.contexts
      .filter((item) => item.props.testID === 'calendar-agenda')
      .at(-1);
  try {
    await screen.findByText('No Cards due this day');
    await pick('2026-11-18');
    await switchView('Week');
    await fireEvent.press(screen.getByRole('button', { name: 'Next week' }));
    expect(
      screen.getByTestId('calendar-day-2026-11-25').props.accessibilityState
        .selected,
    ).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Next week' }));
    await openCard();
    expect(
      screen.getByTestId('calendar-day-2026-12-02').props.accessibilityState
        .selected,
    ).toBe(true);
    await switchView('Month');
    expect(screen.getByText('December 2026')).toBeTruthy();
    await switchView('Week');
    await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await fireEvent.changeText(screen.getByLabelText('Search cards'), 'Card 1');
    // Switching the underlying shared view cannot remount/discard a draft sheet.
    await switchView('Month');
    expect(screen.getByLabelText('Search cards').props.value).toBe('Card 1');
    await switchView('Week');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Apply filters (1)' }),
    );
    await openCard();
    await act(() => {
      const list = currentList();
      list.props.onLayout({ nativeEvent: { layout: { height: 700 } } });
      list.props.onContentSizeChange(320, 1800);
      list.props.onScrollBeginDrag();
      list.props.onScroll({ nativeEvent: { contentOffset: { y: 400 } } });
    });
    await fireEvent.press(await openCard());
    expect(mockRouter.push).toHaveBeenCalledWith(
      `/boards/${boardId}/cards/${dated(1).id}`,
    );
    await env.remountRoute();
    await openCard();
    expect(
      screen.getByRole('radio', { name: 'Week' }).props.accessibilityState
        .checked,
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeTruthy();
    expect(
      screen.getByTestId('calendar-day-2026-12-02').props.accessibilityState
        .selected,
    ).toBe(true);
    await act(() => {
      const list = currentList();
      list.props.onLayout({ nativeEvent: { layout: { height: 700 } } });
      list.props.onContentSizeChange(320, 1800);
    });
    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith({ offset: 400, animated: false }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Filters (1)' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Reset' }));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Apply filters (0)' }),
    );
    await openCard();
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Previous week' }),
    );
    expect(
      screen.getByTestId('calendar-day-2026-11-25').props.accessibilityState
        .selected,
    ).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Today' }));
    expect(
      screen.getByTestId('calendar-day-2026-11-17').props.accessibilityState
        .selected,
    ).toBe(true);
  } finally {
    await env.dispose();
    rendered.mockRestore();
    scrollTo.mockRestore();
    now.mockRestore();
  }
});

test.each([429, 503])(
  'Week partial HTTP %s stays incomplete, honors retry readiness and recovers',
  async (status) => {
    const now = clock();
    let failed = true;
    const rows = Array.from({ length: 101 }, (_, n) => dated(n + 1));
    const env = await setup({
      cards: rows,
      override(url) {
        if (
          failed &&
          url.pathname.endsWith('/cards') &&
          url.searchParams.get('page') === '2'
        )
          return response({}, status, status === 429 ? '1' : undefined);
        return null;
      },
    });
    try {
      await screen.findByText('Calendar incomplete');
      await switchView('Week');
      expect(screen.queryByText('101 Cards')).toBeNull();
      expect(
        screen.getByTestId('calendar-day-2026-11-17').props.accessibilityLabel,
      ).toContain('counts unavailable');
      if (status === 429) {
        expect(
          screen.getByRole('button', { name: 'Retry calendar' }).props
            .accessibilityState.disabled,
        ).toBe(true);
        now.mockReturnValue(Date.parse('2026-11-17T00:00:02Z'));
        await waitFor(() =>
          expect(
            screen.getByRole('button', { name: 'Retry calendar' }).props
              .accessibilityState.disabled,
          ).toBe(false),
        );
      }
      failed = false;
      await fireEvent.press(
        screen.getByRole('button', { name: 'Retry calendar' }),
      );
      await screen.findByText('101 Cards');
      expect(
        screen.getByRole('radio', { name: 'Week' }).props.accessibilityState
          .checked,
      ).toBe(true);
    } finally {
      await env.dispose();
      now.mockRestore();
    }
  },
);

test('Week adopts remote zone/week-start/date-format while keeping selected civil day; Today samples current instant', async () => {
  const now = clock();
  const env = await setup({
    preferences: {
      timeZone: 'UTC',
      weekStartsOn: 'monday',
      dateFormat: 'YYYY-MM-DD',
      theme: 'light',
    },
    cards: [dated(1, '2026-11-17T00:30:00.000Z')],
  });
  try {
    await openCard();
    await switchView('Week');
    env.preferences.timeZone = 'America/Los_Angeles';
    env.preferences.weekStartsOn = 'sunday';
    env.preferences.dateFormat = 'MM/DD/YYYY';
    await act(() =>
      env.data.queryClient.invalidateQueries({
        queryKey: queryKeys.datePreferences(env.data.getIdentity()),
      }),
    );
    await screen.findByText('No Cards due this day');
    expect(
      screen.getByTestId('calendar-day-2026-11-17').props.accessibilityState
        .selected,
    ).toBe(true);
    expect(screen.getAllByTestId(/^calendar-day-/)[0].props.testID).toBe(
      'calendar-day-2026-11-15',
    );
    await pick('2026-11-16');
    await openCard();
    expect(screen.getByText('11/16/2026 \u00b7 16:30')).toBeTruthy();
    await switchView('Month');
    await openCard();
    expect(screen.getByText('11/16/2026 \u00b7 16:30')).toBeTruthy();
    await switchView('Week');
    now.mockReturnValue(Date.parse('2026-11-18T08:01:00Z'));
    // Even without waiting for a scheduled clock tick, Today uses the new instant.
    await fireEvent.press(screen.getByRole('button', { name: 'Today' }));
    expect(
      screen.getByTestId('calendar-day-2026-11-18').props.accessibilityState
        .selected,
    ).toBe(true);
    expect(env.cards[0].dueDate).toBe('2026-11-17T00:30:00.000Z');
  } finally {
    await env.dispose();
    now.mockRestore();
  }
});
