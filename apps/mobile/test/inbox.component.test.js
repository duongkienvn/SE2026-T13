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
          return wire({ timeZone: 'UTC', dateFormat: 'YYYY-MM-DD' });
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
    expect(
      screen.queryByText(/Push|Quiet hours|Notification preferences/),
    ).toBeNull();
  } finally {
    await env.dispose();
  }
});
