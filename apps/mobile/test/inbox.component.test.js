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
import { InboxScreen } from '../src/features/notifications/InboxScreen';
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
import { notification, boardId, workspaceId } from './notifications/fixtures';
import { queryKeys } from '../src/infrastructure/query/keys';

const mockNavigate = jest.fn(),
  mockPush = jest.fn();
let mockFocused = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate, push: mockPush }),
  useIsFocused: () => mockFocused,
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
function wire(data, status = 200, retryAfter = null, meta) {
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
        ...(meta ? { meta } : {}),
      }),
  };
}
async function setup(rows = [notification()], override, mode = 'dark') {
  mockNavigate.mockClear();
  mockPush.mockClear();
  mockFocused = true;
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
  const requests = [];
  const data = createMobileDataLayer(
    manager,
    createHttpClient({
      baseUrl: new URL('https://inbox.example.test/api'),
      fetch: async (input, init) => {
        const url = new URL(input);
        requests.push({ url, init });
        const custom = override?.(url, init);
        if (custom) return custom;
        if (url.pathname === '/api/notifications') {
          const matching =
            url.searchParams.get('filter') === 'unread'
              ? rows.filter((r) => !r.readAt)
              : rows;
          const page = Number(url.searchParams.get('page'));
          return wire(matching.slice((page - 1) * 20, page * 20), 200, null, {
            page,
            limit: 20,
            total: matching.length,
            totalPages: Math.ceil(matching.length / 20),
          });
        }
        if (url.pathname.endsWith('/unread-count'))
          return wire({ count: rows.filter((r) => !r.readAt).length });
        if (url.pathname.endsWith('/read-all')) {
          const updatedCount = rows.filter((r) => !r.readAt).length;
          rows.forEach((row) => {
            row.readAt ??= '2026-11-19T02:00:00Z';
          });
          return wire({ updatedCount });
        }
        if (url.pathname.endsWith('/read')) {
          const row = rows.find((r) =>
            url.pathname.endsWith('/' + r.id + '/read'),
          );
          if (!row) return wire({}, 404);
          row.readAt ??= '2026-11-19T02:00:00Z';
          return wire(row);
        }
        if (url.pathname === '/api/users/me/preferences')
          return wire({
            theme: 'system',
            weekStartsOn: 'monday',
            timeZone: 'UTC',
            dateFormat: 'YYYY-MM-DD',
          });
        if (url.pathname === '/api/boards/' + boardId)
          return wire({
            id: boardId,
            workspaceId,
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
          <InboxScreen />
        </ThemeContext.Provider>
      </DataProvider>
    </SessionProvider>
  );
  const view = await render(tree());
  await act(() => focusManager.setFocused(true));
  return {
    manager,
    data,
    requests,
    rows,
    rerender: () => view.rerender(tree()),
    dispose: async () => {
      await view.unmount();
      data.dispose();
      manager.dispose();
    },
  };
}
const press = async (name) =>
  fireEvent.press(await screen.findByRole('button', { name }));
afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(true);
  jest.useRealTimers();
});

test('Inbox opens Notification preferences without changing notification read state', async () => {
  const env = await setup();
  try {
    await press('Notification preferences');
    expect(mockPush).toHaveBeenCalledWith('/notification-preferences');
    expect(
      env.requests.filter(
        (r) => r.init.method === 'PATCH' || r.init.method === 'POST',
      ),
    ).toHaveLength(0);
  } finally {
    await env.dispose();
  }
});
test('Inbox loads actual rows, exact unread count and bodyless read actions without auto-marking on open', async () => {
  const env = await setup();
  try {
    await screen.findByText(notification().summary);
    expect(
      screen.getByRole('button', { name: 'Unread, 1 unread notifications' }),
    ).toBeTruthy();
    await press(/Open notification:/);
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(notification().target.path),
    );
    expect(env.requests.filter((r) => r.init.method === 'PATCH')).toHaveLength(
      0,
    );
    await press(/Mark as read:/);
    await screen.findByRole('button', {
      name: 'Unread, 0 unread notifications',
    });
    const write = env.requests.find((r) => r.init.method === 'PATCH');
    expect(write.init.body).toBeUndefined();
    expect(
      screen.getByRole('button', { name: 'Mark all as read' }),
    ).toBeDisabled();
  } finally {
    await env.dispose();
  }
});
test('server count includes unavailable history and compact 99+ retains the exact accessible count', async () => {
  const rows = Array.from({ length: 101 }, (_, n) =>
    notification(300 - n, {
      summary:
        n === 0 ? 'Visible update' : 'This notification is no longer available',
      isUnavailable: n > 0,
    }),
  );
  const env = await setup(rows);
  try {
    await screen.findByText('Visible update');
    expect(
      screen.getByRole('button', { name: 'Unread, 101 unread notifications' }),
    ).toBeTruthy();
    expect(screen.getByText(/99\+/)).toBeTruthy();
    await press('Mark all as read');
    await screen.findByRole('button', {
      name: 'Unread, 0 unread notifications',
    });
    const write = env.requests.find((r) =>
      r.url.pathname.endsWith('/read-all'),
    );
    expect(write.init.method).toBe('POST');
    expect(write.init.body).toBeUndefined();
    expect(screen.queryByText(/Push|Quiet hours/)).toBeNull();
  } finally {
    await env.dispose();
  }
});

test('All/Unread pagination resets and a confirmed read removes its row from Unread', async () => {
  const rows = Array.from({ length: 21 }, (_, n) =>
    notification(300 - n, { summary: 'Update ' + n }),
  );
  const env = await setup(rows);
  try {
    await screen.findByText('Update 0');
    expect(screen.queryByText('Update 20')).toBeNull();
    await press('Load more notifications');
    await screen.findByText('Update 20');
    await press('Unread, 21 unread notifications');
    await waitFor(() => expect(screen.queryByText('Update 20')).toBeNull());
    await press('Mark as read: Update 0');
    await screen.findByRole('button', {
      name: 'Unread, 20 unread notifications',
    });
    await waitFor(() => expect(screen.queryByText('Update 0')).toBeNull());
    await screen.findByText('Update 20');
    expect(
      screen.queryByRole('button', { name: 'Load more notifications' }),
    ).toBeNull();
    await press('All');
    await screen.findByText('Update 0');
    expect(screen.queryByText('Update 20')).toBeNull();
  } finally {
    await env.dispose();
  }
});

test('ambiguous read-all is not retried; a count-only review cannot unblock writes', async () => {
  let reviewing = false,
    failReview = true;
  const rows = [notification()];
  const env = await setup(rows, (url) => {
    if (url.pathname.endsWith('/read-all')) {
      rows[0].readAt = '2026-11-19T02:00:00Z';
      reviewing = true;
      return wire({}, 500);
    }
    if (reviewing && failReview && url.pathname === '/api/notifications')
      return wire({}, 500);
    return null;
  });
  try {
    await screen.findByText(rows[0].summary);
    await press('Mark all as read');
    await screen.findByText(
      'Read status wasn’t confirmed. Review the Inbox before trying again.',
    );
    expect(
      screen.getByRole('button', { name: 'Mark all as read' }),
    ).toBeDisabled();
    await press('Review Inbox');
    await screen.findByRole('button', { name: 'Review Inbox' });
    expect(
      screen.getByRole('button', { name: 'Mark all as read' }),
    ).toBeDisabled();
    expect(
      env.requests.filter((r) => r.url.pathname.endsWith('/read-all')),
    ).toHaveLength(1);
    failReview = false;
    await press('Review Inbox');
    await screen.findByRole('button', {
      name: 'Unread, 0 unread notifications',
    });
    expect(screen.queryByRole('button', { name: 'Review Inbox' })).toBeNull();
    expect(
      env.requests.filter((r) => r.url.pathname.endsWith('/read-all')),
    ).toHaveLength(1);
  } finally {
    await env.dispose();
  }
});

test('read-all updatedCount zero is valid and count is independently refreshed', async () => {
  const rows = [notification()];
  const env = await setup(rows, (url) => {
    if (!url.pathname.endsWith('/read-all')) return null;
    rows[0].readAt = '2026-11-19T02:00:00Z';
    return wire({ updatedCount: 0 });
  });
  try {
    await screen.findByText(rows[0].summary);
    await press('Mark all as read');
    await screen.findByRole('button', {
      name: 'Unread, 0 unread notifications',
    });
    expect(screen.queryByRole('button', { name: 'Review Inbox' })).toBeNull();
  } finally {
    await env.dispose();
  }
});

test('one-row 404 refreshes owned history without declaring the whole Inbox unauthorized', async () => {
  const rows = [
    notification(2, { summary: 'Missing row' }),
    notification(1, { summary: 'Still available' }),
  ];
  const env = await setup(rows, (url) => {
    if (!url.pathname.endsWith('/read')) return null;
    rows.splice(0, 1);
    return wire({}, 404);
  });
  try {
    await screen.findByText('Missing row');
    await press('Mark as read: Missing row');
    await screen.findByText('Still available');
    await waitFor(() => expect(screen.queryByText('Missing row')).toBeNull());
    await screen.findByRole('button', {
      name: 'Unread, 1 unread notifications',
    });
    expect(
      env.data.resources.readable(
        queryKeys.board(env.data.getIdentity(), boardId),
      ),
    ).toBe(true);
    await screen.findByText(
      'That notification is no longer available. Refresh your Inbox.',
    );
    await press('Refresh Inbox');
    await waitFor(() =>
      expect(
        screen.queryByText(
          'That notification is no longer available. Refresh your Inbox.',
        ),
      ).toBeNull(),
    );
  } finally {
    await env.dispose();
  }
});

test('offline and tab blur hide rows, retain filter, and verify history again on return', async () => {
  const env = await setup();
  try {
    await screen.findByText(notification().summary);
    await press('Unread, 1 unread notifications');
    await act(() => onlineManager.setOnline(false));
    expect(screen.queryByText(notification().summary)).toBeNull();
    expect(
      screen.getByText('You’re offline. Reconnect to refresh your Inbox.'),
    ).toBeTruthy();
    const before = env.requests.length;
    mockFocused = false;
    await env.rerender();
    expect(env.requests).toHaveLength(before);
    await act(() => onlineManager.setOnline(true));
    expect(screen.queryByText(notification().summary)).toBeNull();
    mockFocused = true;
    await env.rerender();
    await screen.findByText(notification().summary);
    expect(
      screen.getByRole('button', { name: 'Unread, 1 unread notifications' })
        .props.accessibilityState.selected,
    ).toBe(true);
  } finally {
    await env.dispose();
  }
});

test('list 429 cooldown survives filter changes and foreground reconciliation', async () => {
  jest.useFakeTimers();
  let limited = true;
  const env = await setup([notification()], (url) =>
    url.pathname === '/api/notifications' && limited
      ? wire({}, 429, '300')
      : null,
  );
  try {
    await screen.findByText('Too many requests. Wait before trying again.');
    const count = env.requests.filter(
      (r) => r.url.pathname === '/api/notifications',
    ).length;
    await press('Unread, 1 unread notifications');
    mockFocused = false;
    await env.rerender();
    mockFocused = true;
    await env.rerender();
    await act(() => jest.advanceTimersByTimeAsync(30_000));
    expect(
      env.requests.filter((r) => r.url.pathname === '/api/notifications'),
    ).toHaveLength(count);
    expect(
      screen.getByText('Too many requests. Wait before trying again.'),
    ).toBeTruthy();
    limited = false;
    await act(() => jest.advanceTimersByTimeAsync(270_000));
    await screen.findByText(notification().summary);
  } finally {
    await env.dispose();
  }
});

test('shrinking last page drops obsolete rows and refreshes the independent unread count', async () => {
  const rows = Array.from({ length: 21 }, (_, n) =>
    notification(300 - n, { summary: 'Earlier ' + n }),
  );
  let shrinking = true;
  const env = await setup(rows, (url) => {
    if (
      url.pathname !== '/api/notifications' ||
      url.searchParams.get('page') !== '2' ||
      !shrinking
    )
      return null;
    shrinking = false;
    rows.splice(
      0,
      rows.length,
      notification(500, { summary: 'Current notification' }),
    );
    return wire([], 200, null, { page: 2, limit: 20, total: 1, totalPages: 1 });
  });
  try {
    await screen.findByText('Earlier 0');
    await press('Load more notifications');
    await screen.findByText('Current notification');
    expect(screen.queryByText('Earlier 0')).toBeNull();
    await screen.findByRole('button', {
      name: 'Unread, 1 unread notifications',
    });
    const pages = env.requests
      .filter((r) => r.url.pathname === '/api/notifications')
      .map((r) => r.url.searchParams.get('page'));
    expect(pages.slice(-2)).toEqual(['2', '1']);
    expect(pages.filter((value) => value === '2')).toHaveLength(1);
  } finally {
    await env.dispose();
  }
});

test('revocation during mark-read strips private rows and stale ACK cannot restore them', async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const rows = [notification(1, { summary: 'Private original' })];
  const env = await setup(rows, (url) =>
    url.pathname.endsWith('/read') ? pending : null,
  );
  try {
    await screen.findByText('Private original');
    await press('Mark as read: Private original');
    rows[0] = notification(1, {
      isUnavailable: true,
      summary: 'This notification is no longer available',
    });
    await act(() =>
      env.data.evict(env.data.getIdentity(), [
        queryKeys.notifications(env.data.getIdentity()),
      ]),
    );
    await waitFor(() =>
      expect(screen.queryByText('Private original')).toBeNull(),
    );
    await act(async () =>
      finish(
        wire(
          notification(1, {
            summary: 'Private original',
            readAt: '2026-11-19T02:00:00Z',
          }),
        ),
      ),
    );
    await screen.findByRole('button', { name: 'Review Inbox' });
    expect(screen.queryByText('Private original')).toBeNull();
    await press('Review Inbox');
    await screen.findByText('No longer available');
    expect(screen.queryByText('Teammate')).toBeNull();
    const cached = env.data.queryClient
      .getQueryCache()
      .findAll({ queryKey: queryKeys.notifications(env.data.getIdentity()) })
      .map((query) => query.state.data);
    expect(JSON.stringify(cached)).not.toMatch(/Private original|Teammate/);
  } finally {
    await env.dispose();
  }
});

test('account switch suppresses an ignored-abort old response and resets the filter', async () => {
  let old = true,
    finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const rows = [notification(1, { summary: 'Account B update' })];
  const env = await setup(rows, (url) =>
    url.pathname === '/api/notifications' && old ? pending : null,
  );
  try {
    old = false;
    await act(() => env.manager.establishSession(loginResponse(USER_B)));
    await screen.findByText('Account B update');
    await act(async () =>
      finish(
        wire([notification(1, { summary: 'Account A secret' })], 200, null, {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
        }),
      ),
    );
    expect(screen.queryByText('Account A secret')).toBeNull();
    expect(
      env.data.queryClient
        .getQueryCache()
        .findAll({ queryKey: ['mobile', 'private', USER_A] }),
    ).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'All' }).props.accessibilityState
        .selected,
    ).toBe(true);
  } finally {
    await env.dispose();
  }
});

test('401 removes authenticated Inbox and cancels protected reads', async () => {
  const env = await setup([notification()], (url) =>
    url.pathname === '/api/notifications' ? wire({}, 401) : null,
  );
  try {
    await waitFor(() => expect(screen.queryByText('Inbox')).toBeNull());
    expect(env.manager.getSnapshot().status).not.toBe('authenticated');
  } finally {
    await env.dispose();
  }
});

test('partial pagination failure retains loaded rows and retries only the requested page', async () => {
  const rows = Array.from({ length: 21 }, (_, n) =>
    notification(300 - n, { summary: 'Page item ' + n }),
  );
  let fail = true;
  const env = await setup(rows, (url) =>
    url.pathname === '/api/notifications' &&
    url.searchParams.get('page') === '2' &&
    fail
      ? wire({}, 500)
      : null,
  );
  try {
    await screen.findByText('Page item 0');
    await press('Load more notifications');
    await screen.findByText(
      'Couldn’t load the next page. Your loaded notifications are below.',
    );
    expect(screen.getByText('Page item 0')).toBeTruthy();
    fail = false;
    await press('Retry load more');
    await screen.findByText('Page item 20');
    expect(
      env.requests.filter((r) => r.url.searchParams.get('page') === '2'),
    ).toHaveLength(2);
  } finally {
    await env.dispose();
  }
});

test('preference failure falls back to UTC and local calendar labels advance at midnight without refetch', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-19T23:59:30Z'));
  const env = await setup([notification()], (url) =>
    url.pathname === '/api/users/me/preferences' ? wire({}, 500) : null,
  );
  try {
    await screen.findByRole('header', { name: 'Today' });
    expect(screen.getByText('Dates in UTC')).toBeTruthy();
    const before = env.requests.length;
    await act(() => jest.advanceTimersByTimeAsync(30_001));
    expect(screen.getByRole('header', { name: 'Yesterday' })).toBeTruthy();
    expect(env.requests).toHaveLength(before);
  } finally {
    await env.dispose();
  }
});

test('saved timezone and date format determine grouping and time independently of the device', async () => {
  const env = await setup(
    [notification(1, { createdAt: '2026-11-19T01:00:00Z' })],
    (url) =>
      url.pathname === '/api/users/me/preferences'
        ? wire({
            theme: 'system',
            weekStartsOn: 'monday',
            timeZone: 'America/New_York',
            dateFormat: 'DD/MM/YYYY',
          })
        : null,
    'light',
  );
  try {
    await screen.findByText('Dates in America/New_York');
    // Preferences can resolve before the notification page; wait for the row.
    expect(await screen.findByText('18/11/2026 · 20:00')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Open notification:/ }).props
        .accessibilityLabel,
    ).toContain('UTC−05:00');
  } finally {
    await env.dispose();
  }
});
