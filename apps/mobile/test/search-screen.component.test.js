/* global jest, test, expect, afterEach */
import { URL } from 'node:url';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { SearchScreen } from '../src/features/search/SearchScreen';
import { createHttpClient } from '../src/infrastructure/api/client';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
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
import { results, cardHit } from './search/fixtures';
import { uuid } from './workspaces/fixtures';
import { ApiError } from '../src/infrastructure/api/errors';
import { queryKeys } from '../src/infrastructure/query/keys';

const mockNavigate = jest.fn();
let mockFocused = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate }),
  useIsFocused: () => mockFocused,
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
async function setup(override, mode = 'dark') {
  mockNavigate.mockClear();
  mockFocused = true;
  const clock = new FakeTime();
  const auth = new FakeSessionApi();
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
  const requests = [];
  const data = createMobileDataLayer(
    manager,
    createHttpClient({
      baseUrl: new URL('https://search.example.test/api'),
      fetch: async (input, init) => {
        const url = new URL(input);
        requests.push({ url, init });
        const response = override?.(url, init);
        if (response) return response;
        if (url.pathname === '/api/search')
          return wire(
            results(url.searchParams.get('type'), url.searchParams.get('q')),
          );
        if (url.pathname === '/api/boards/' + cardHit.boardId)
          return wire({
            id: cardHit.boardId,
            workspaceId: cardHit.workspaceId,
            isArchived: false,
            capabilities: { canReadBoard: true, canWriteBoard: false },
          });
        return wire({}, 404);
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
  const tree = () => (
    <SessionProvider manager={manager}>
      <DataProvider layer={data}>
        <ThemeContext.Provider value={mode}>
          <SearchScreen />
        </ThemeContext.Provider>
      </DataProvider>
    </SessionProvider>
  );
  const view = await render(tree());
  await act(() => focusManager.setFocused(true));
  return {
    requests,
    manager,
    data,
    rerender: () => view.rerender(tree()),
    dispose: async () => {
      await view.unmount();
      data.dispose();
      manager.dispose();
    },
  };
}
const input = () =>
  screen.getByLabelText('Search workspaces, boards and cards');
const enter = async (text) => {
  await fireEvent.changeText(input(), text);
  await fireEvent(input(), 'submitEditing');
};
afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(true);
  jest.useRealTimers();
});

test('blank native Search has real type shortcuts, no network, no history or unsupported filters', async () => {
  const env = await setup();
  try {
    expect(input().props.autoFocus).toBe(true);
    expect(
      screen.getByText('Find workspaces, boards and cards you can access.'),
    ).toBeTruthy();
    expect(screen.queryByText(/Recent|Trending|Search filters/)).toBeNull();
    await fireEvent.changeText(input(), '   ');
    expect(
      env.requests.filter((r) => r.url.pathname === '/api/search'),
    ).toHaveLength(0);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Try searching Cards' }),
    );
    expect(
      screen.getByRole('button', { name: 'Cards' }).props.accessibilityState
        .selected,
    ).toBe(true);
  } finally {
    await env.dispose();
  }
});
test('Return submits immediately, renders server groups and opens a canonical guarded Card', async () => {
  const env = await setup();
  try {
    await enter(' design ');
    await screen.findByText('Design card');
    expect(screen.getByRole('button', { name: 'All · 3' })).toBeTruthy();
    const search = env.requests.find(
      (r) => r.url.pathname === '/api/search',
    ).url;
    expect(search.searchParams.has('page')).toBe(false);
    expect(search.searchParams.get('limit')).toBe('5');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Open Design card, Design board' }),
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(cardHit.path),
    );
  } finally {
    await env.dispose();
  }
});

test('typing debounces for 250ms, hides prior rows and rejects ignored-abort responses', async () => {
  jest.useFakeTimers();
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const env = await setup((url) =>
    url.searchParams.get('q') === 'slow' ? pending : null,
  );
  try {
    await enter('design');
    await screen.findByText('Design card');
    await fireEvent.changeText(input(), 's');
    expect(screen.queryByText('Design card')).toBeNull();
    await act(() => jest.advanceTimersByTimeAsync(249));
    expect(
      env.requests.filter((r) => r.url.pathname === '/api/search'),
    ).toHaveLength(1);
    await fireEvent.changeText(input(), 'slow');
    await act(() => jest.advanceTimersByTimeAsync(250));
    const slow = env.requests.find(
      (r) => r.url.searchParams.get('q') === 'slow',
    );
    expect(slow).toBeTruthy();
    await enter('latest');
    await screen.findByText('Design card');
    expect(slow.init.signal.aborted).toBe(true);
    const stale = results('all', 'slow');
    stale.groups.cards.items[0] = { ...cardHit, title: 'Stale secret' };
    await act(async () => finish(wire(stale)));
    expect(screen.queryByText('Stale secret')).toBeNull();
    expect(screen.getByText('3 results for “latest”')).toBeTruthy();
  } finally {
    await env.dispose();
  }
});

test('Unicode validation blocks malformed/121 code point queries and supports 120 emoji', async () => {
  const env = await setup();
  try {
    for (const q of ['😀'.repeat(121), 'bad\0text', '\ud800']) {
      await enter(q);
      expect(
        env.requests.filter((r) => r.url.pathname === '/api/search'),
      ).toHaveLength(0);
    }
    await enter('😀'.repeat(120));
    await screen.findByText('Design card');
    expect(
      env.requests.filter((r) => r.url.pathname === '/api/search'),
    ).toHaveLength(1);
  } finally {
    await env.dispose();
  }
});

test('View all starts at page one, duplicate taps fetch one next page, and changing type resets pagination', async () => {
  jest.useFakeTimers();
  const env = await setup((url) => {
    if (url.pathname !== '/api/search') return null;
    const type = url.searchParams.get('type');
    const value = results(type, url.searchParams.get('q'));
    const page = Number(url.searchParams.get('page') || 1);
    value.groups.cards = {
      total: 21,
      hasMore: type === 'all' || page === 1,
      items: Array.from(
        { length: type === 'all' ? 5 : page === 1 ? 20 : 1 },
        (_, i) => ({
          ...cardHit,
          id: uuid(page * 100 + i),
          title: `Paged card ${page * 100 + i}`,
          path: `/boards/${cardHit.boardId}/cards/${uuid(page * 100 + i)}`,
        }),
      ),
    };
    return wire(value);
  });
  try {
    await enter('design');
    await screen.findByText('Paged card 100');
    await fireEvent.press(
      screen.getByRole('button', { name: 'View all Cards' }),
    );
    await act(() => jest.advanceTimersByTimeAsync(250));
    await screen.findByRole('button', { name: 'Load more results' });
    await fireEvent.press(
      screen.getByRole('button', { name: 'Load more results' }),
    );
    await screen.findByText('Paged card 200');
    expect(
      screen.queryByRole('button', { name: 'Load more results' }),
    ).toBeNull();
    expect(
      env.requests.filter((r) => r.url.searchParams.get('page') === '2'),
    ).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'All' }));
    await act(() => jest.advanceTimersByTimeAsync(250));
    await screen.findByRole('button', { name: 'View all Cards' });
    await fireEvent.press(
      screen.getByRole('button', { name: 'View all Cards' }),
    );
    await act(() => jest.advanceTimersByTimeAsync(250));
    await screen.findByRole('button', { name: 'Load more results' });
    expect(screen.queryByText('Paged card 200')).toBeNull();
    expect(
      env.requests
        .filter((r) => r.url.searchParams.get('type') === 'cards')
        .map((r) => r.url.searchParams.get('page')),
    ).toEqual(['1', '2', '1']);
  } finally {
    await env.dispose();
  }
});

test('offline hides protected rows and reconnect revalidates the current query', async () => {
  const env = await setup();
  try {
    await enter('design');
    await screen.findByText('Design card');
    await act(() => onlineManager.setOnline(false));
    expect(screen.queryByText('Design card')).toBeNull();
    expect(
      screen.getByText('You’re offline. Reconnect to search.'),
    ).toBeTruthy();
    await act(() => onlineManager.setOnline(true));
    await screen.findByText('Design card');
    expect(
      env.requests.filter((r) => r.url.pathname === '/api/search').length,
    ).toBeGreaterThan(1);
  } finally {
    await env.dispose();
  }
});

test('429 respects Retry-After across focus transitions and retries after the cooldown', async () => {
  jest.useFakeTimers();
  let limited = true;
  const env = await setup((url) =>
    url.pathname === '/api/search' && limited ? wire({}, 429, '300') : null,
  );
  try {
    await enter('design');
    await screen.findByRole('button', { name: 'Retry search' });
    expect(screen.getByRole('button', { name: 'Retry search' })).toBeDisabled();
    const count = env.requests.length;
    await act(() => jest.advanceTimersByTimeAsync(30_000));
    await act(() => focusManager.setFocused(false));
    await act(() => focusManager.setFocused(true));
    expect(env.requests).toHaveLength(count);
    limited = false;
    await act(() => jest.advanceTimersByTimeAsync(270_000));
    await fireEvent.press(screen.getByRole('button', { name: 'Retry search' }));
    await screen.findByText('Design card');
  } finally {
    await env.dispose();
  }
});

test.each([
  [400, 'Search could not be accepted. Check your query and try again.'],
  [403, 'Search access changed. Retry to check what’s available.'],
  [404, 'Search access changed. Retry to check what’s available.'],
  [500, 'Couldn’t verify search results. Retry to check what’s available.'],
])(
  'HTTP %s is safe and recoverable without protected stale rows',
  async (status, message) => {
    let fail = true;
    const env = await setup((url) =>
      url.pathname === '/api/search' && fail ? wire({}, status) : null,
    );
    try {
      await enter('design');
      await screen.findByText(message);
      expect(screen.queryByText('Design card')).toBeNull();
      fail = false;
      await fireEvent.press(
        screen.getByRole('button', { name: 'Retry search' }),
      );
      await screen.findByText('Design card');
    } finally {
      await env.dispose();
    }
  },
);

test('timeout and empty result states provide an accessible recovery path', async () => {
  let fail = true;
  const env = await setup((url) => {
    if (url.pathname !== '/api/search') return null;
    if (fail) return Promise.reject(new ApiError('timeout'));
    const value = results('all', url.searchParams.get('q'));
    for (const group of Object.values(value.groups)) {
      group.items = [];
      group.total = 0;
    }
    return wire(value);
  });
  try {
    await enter('empty');
    await screen.findByText('Search took too long. Try again.');
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Retry search' }));
    const empty = await screen.findByText('No results. Try another search.');
    expect(empty.props.accessibilityLiveRegion).toBe('polite');
  } finally {
    await env.dispose();
  }
});

test('pagination failure keeps verified rows and explicit retry recovers without duplicate submissions', async () => {
  let finish;
  let fail = true;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const env = await setup((url) => {
    if (url.pathname !== '/api/search') return null;
    const value = results('cards', url.searchParams.get('q'));
    if (url.searchParams.get('page') === '2')
      return fail ? wire({}, 500) : pending;
    value.groups.cards = {
      total: 21,
      hasMore: true,
      items: Array.from({ length: 20 }, (_, i) => ({
        ...cardHit,
        id: uuid(i),
        title: 'Loaded ' + i,
        path: `/boards/${cardHit.boardId}/cards/${uuid(i)}`,
      })),
    };
    return wire(value);
  });
  try {
    await fireEvent.press(screen.getByRole('button', { name: 'Cards' }));
    await enter('design');
    await screen.findByText('Loaded 0');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Load more results' }),
    );
    await screen.findByText(
      'Couldn’t load more results. Your loaded results are below.',
    );
    expect(screen.getByText('Loaded 0')).toBeTruthy();
    fail = false;
    const retry = screen.getByRole('button', { name: 'Retry load more' });
    await fireEvent.press(retry);
    await fireEvent.press(retry);
    const value = results('cards', 'design');
    value.groups.cards.total = 21;
    await act(async () => finish(wire(value)));
    await screen.findByText('Design card');
    expect(
      env.requests.filter((r) => r.url.searchParams.get('page') === '2'),
    ).toHaveLength(2);
  } finally {
    await env.dispose();
  }
});

test('route blur cancels a pending search and Back preserves query/type while verifying results again', async () => {
  jest.useFakeTimers();
  let finish;
  let pending = false;
  const deferred = new Promise((resolve) => {
    finish = resolve;
  });
  const env = await setup(
    (url) => (url.pathname === '/api/search' && pending ? deferred : null),
    'light',
  );
  try {
    await fireEvent.press(screen.getByRole('button', { name: 'Cards' }));
    await enter('design');
    await screen.findByText('Design card');
    pending = true;
    await enter('slow');
    mockFocused = false;
    await env.rerender();
    const request = env.requests.find(
      (r) => r.url.searchParams.get('q') === 'slow',
    );
    expect(request.init.signal.aborted).toBe(true);
    await act(async () => finish(wire(results('cards', 'slow'))));
    expect(screen.queryByText('Design card')).toBeNull();
    pending = false;
    mockFocused = true;
    await env.rerender();
    await screen.findByText('Design card');
    expect(input().props.value).toBe('slow');
    expect(
      screen.getByRole('button', { name: 'Cards · 1' }).props.accessibilityState
        .selected,
    ).toBe(true);
  } finally {
    await env.dispose();
  }
});

test('ACL eviction hides rows during revalidation and blocks a pending result tap', async () => {
  let finish;
  let revoked = false;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const env = await setup((url) =>
    url.pathname.startsWith('/api/boards/')
      ? pending
      : url.pathname === '/api/search' && revoked
        ? pending
        : null,
  );
  try {
    await enter('design');
    await screen.findByText('Design card');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Open Design card, Design board' }),
    );
    revoked = true;
    await act(() =>
      env.data.evict(env.data.getIdentity(), [
        queryKeys.search(env.data.getIdentity()),
      ]),
    );
    expect(
      env.data.queryClient
        .getQueryCache()
        .findAll({ queryKey: queryKeys.search(env.data.getIdentity()) })
        .every((query) => query.state.data === undefined),
    ).toBe(true);
    await waitFor(() => expect(screen.queryByText('Design card')).toBeNull());
    await act(async () =>
      finish(
        wire({
          id: cardHit.boardId,
          workspaceId: cardHit.workspaceId,
          isArchived: false,
          capabilities: { canReadBoard: true, canWriteBoard: true },
        }),
      ),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  } finally {
    await env.dispose();
  }
});

test('account switch clears input/type and old protected responses cannot return', async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const env = await setup((url) =>
    url.pathname === '/api/search' ? pending : null,
  );
  try {
    await fireEvent.press(screen.getByRole('button', { name: 'Cards' }));
    await enter('private');
    await act(() => env.manager.establishSession(loginResponse(USER_B)));
    expect(input().props.value).toBe('');
    expect(
      screen.getByRole('button', { name: 'All' }).props.accessibilityState
        .selected,
    ).toBe(true);
    await act(async () => finish(wire(results('cards', 'private'))));
    expect(screen.queryByText('Design card')).toBeNull();
    expect(
      env.data.queryClient
        .getQueryCache()
        .findAll({ queryKey: ['mobile', 'private', USER_A] }),
    ).toHaveLength(0);
  } finally {
    await env.dispose();
  }
});
