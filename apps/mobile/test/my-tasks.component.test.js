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
import { MyTasksScreen } from '../src/features/tasks/MyTasksScreen';
import { createHttpClient } from '../src/infrastructure/api/client';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { createSessionManager } from '../src/infrastructure/auth/session-manager';
import { createCredentialStore } from '../src/infrastructure/auth/credential-store';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { createMobileDataLayer } from '../src/infrastructure/query/data-layer';
import { queryKeys } from '../src/infrastructure/query/keys';
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
import { fixture, boardId, workspaceId } from './home/fixtures';
import { workspace, board, uuid } from './workspaces/fixtures';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

const mockNavigate = jest.fn();
let mockFocused = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate, push: jest.fn() }),
  useIsFocused: () => mockFocused,
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn(async () => {}) },
}));
jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  return Object.create(Object.getPrototypeOf(native), {
    ...Object.getOwnPropertyDescriptors(native),
    Platform: { value: { ...native.Platform, OS: 'android' } },
    Modal: {
      value: ({ visible, children, onRequestClose }) =>
        visible ? (
          <native.View testID="task-modal" onTouchEnd={onRequestClose}>
            {children}
          </native.View>
        ) : null,
    },
    RefreshControl: {
      value: ({ onRefresh }) => (
        <native.View testID="task-refresh" onTouchEnd={onRefresh} />
      ),
    },
  });
});
const groups = ['OVERDUE', 'NEXT_7_DAYS', 'LATER', 'NO_DUE_DATE'];
function row(index, group = 'NO_DUE_DATE') {
  return {
    ...fixture().upNext[0],
    id: uuid(500 + index),
    title: 'Task ' + index,
    labels: [],
    group,
    dueDate: group === 'NO_DUE_DATE' ? null : '2026-11-10T00:00:00.000Z',
    permalink: `/boards/${boardId}/cards/${uuid(500 + index)}`,
  };
}
function wire(body, status = 200, after = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key) =>
        key === 'content-type'
          ? 'application/json'
          : key === 'retry-after'
            ? after
            : null,
    },
    text: async () => JSON.stringify(body),
  };
}
const ok = (data) =>
  wire({ success: true, statusCode: 200, message: 'OK', data });
function taskPage(rows, url) {
  const group = url.searchParams.get('group') ?? 'ALL';
  const matching =
    group === 'ALL' ? rows : rows.filter((row) => row.group === group);
  const page = Number(url.searchParams.get('page'));
  return wire({
    success: true,
    statusCode: 200,
    message: 'OK',
    data: matching.slice((page - 1) * 20, page * 20),
    meta: {
      page,
      limit: 20,
      total: matching.length,
      totalPages: Math.ceil(matching.length / 20),
    },
    groupCounts: Object.fromEntries(
      groups.map((key) => [
        key,
        rows.filter((row) => row.group === key).length,
      ]),
    ),
  });
}
async function setup(rows = [row(1)], override) {
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
      baseUrl: new URL('https://tasks.example.test/api'),
      fetch: async (input, init) => {
        const url = new URL(input);
        requests.push({ url, init });
        const result = override?.(url, init);
        if (result) return result;
        if (url.pathname === '/api/users/me/tasks') return taskPage(rows, url);
        if (url.pathname.endsWith('/preferences'))
          return ok({ timeZone: 'America/New_York', dateFormat: 'YYYY-MM-DD' });
        if (url.pathname === `/api/boards/${boardId}`)
          return ok({
            id: boardId,
            workspaceId,
            isArchived: false,
            capabilities: { canReadBoard: true, canWriteBoard: false },
          });
        if (url.pathname === '/api/workspaces')
          return wire({
            success: true,
            statusCode: 200,
            message: 'OK',
            data: [{ ...workspace(3), id: workspaceId }],
            meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
          });
        if (url.pathname === '/api/boards')
          return wire({
            success: true,
            statusCode: 200,
            message: 'OK',
            data: [
              {
                ...board(workspaceId),
                id: boardId,
                createdById: USER_A,
                isArchived: false,
              },
            ],
            meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
          });
        if (url.pathname.endsWith('/labels'))
          return wire({
            success: true,
            statusCode: 200,
            message: 'OK',
            data: [{ id: uuid(42), boardId, name: 'Review', color: '#336699' }],
            meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
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
        <ThemeContext.Provider value="dark">
          <MyTasksScreen />
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

test('My Tasks shows all server counts, ordered groups and canonical guarded Card navigation', async () => {
  const env = await setup(groups.map((group, index) => row(index, group)));
  try {
    await screen.findByText('Task 0');
    expect(screen.queryByText('Completed')).toBeNull();
    for (const name of [
      'All · 4',
      'Overdue · 1',
      'Next 7 days · 1',
      'Later · 1',
      'No due date · 1',
    ])
      expect(screen.getByRole('button', { name })).toBeTruthy();
    const headers = screen
      .getAllByRole('header')
      .map((node) => node.props.children)
      .flat()
      .join(' ');
    expect(headers.indexOf('Overdue')).toBeLessThan(
      headers.indexOf('Next 7 days'),
    );
    await press(/^Open Task 0,/);
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(row(0).permalink),
    );
    expect(
      env.requests.filter(
        ({ url }) => url.pathname === `/api/boards/${boardId}`,
      ),
    ).toHaveLength(1);
  } finally {
    await env.dispose();
  }
});

test('explicit pagination loads 101 Cards without duplicate requests and resets returning groups', async () => {
  const env = await setup(
    Array.from({ length: 101 }, (_, index) => row(index)),
  );
  try {
    await screen.findByText('20 loaded · 101 matching tasks');
    for (let page = 2; page <= 6; page++) {
      await press('Load more tasks');
      await screen.findByText(
        `${Math.min(page * 20, 101)} loaded · 101 matching tasks`,
      );
    }
    expect(
      screen.queryByRole('button', { name: 'Load more tasks' }),
    ).toBeNull();
    expect(
      env.requests
        .filter(({ url }) => url.pathname.endsWith('/tasks'))
        .map(({ url }) => url.searchParams.get('page')),
    ).toEqual(['1', '2', '3', '4', '5', '6']);
    await press('Overdue · 0');
    await screen.findByText('No tasks in this group.');
    await press('All · 101');
    await screen.findByText('20 loaded · 101 matching tasks');
    expect(screen.queryByText('Task 100')).toBeNull();
  } finally {
    await env.dispose();
  }
});

test('a failed next page keeps earlier tasks and Retry loads that page once', async () => {
  let failed = true;
  const env = await setup(
    Array.from({ length: 21 }, (_, i) => row(i)),
    (url) =>
      url.pathname.endsWith('/tasks') &&
      url.searchParams.get('page') === '2' &&
      failed
        ? wire({}, 503)
        : null,
  );
  try {
    await screen.findByText('Task 0');
    await press('Load more tasks');
    await screen.findByRole('button', { name: 'Retry load more' });
    expect(screen.getByText('Task 0')).toBeTruthy();
    failed = false;
    await press('Retry load more');
    await screen.findByText('Task 20');
    expect(screen.getByText('21 loaded · 21 matching tasks')).toBeTruthy();
  } finally {
    await env.dispose();
  }
});

test('group change during a request and account replacement cannot show stale tasks', async () => {
  let settle;
  const pending = new Promise((resolve) => {
    settle = resolve;
  });
  let first = true;
  const env = await setup([row(1)], (url) => {
    if (url.pathname.endsWith('/tasks') && first) {
      first = false;
      return pending;
    }
    return null;
  });
  try {
    await press('Overdue');
    await screen.findByText('No tasks in this group.');
    await act(() =>
      settle(taskPage([row(999)], new URL('https://tasks.test/?page=1'))),
    );
    expect(screen.queryByText('Task 999')).toBeNull();
    await act(() => env.manager.establishSession(loginResponse(USER_B)));
    expect(screen.queryByText('Task 999')).toBeNull();
    expect(
      env.data.queryClient
        .getQueryCache()
        .getAll()
        .every(({ queryKey }) => queryKey[2] !== USER_A),
    ).toBe(true);
  } finally {
    await env.dispose();
  }
});

test('429 cooldown blocks Retry and foreground reads until its deadline, then recovers', async () => {
  jest.useFakeTimers();
  let limited = true;
  const env = await setup([row(1)], (url) =>
    url.pathname.endsWith('/tasks') && limited ? wire({}, 429, '300') : null,
  );
  try {
    await screen.findByRole('button', { name: 'Retry tasks' });
    const requests = () =>
      env.requests.filter(({ url }) => url.pathname.endsWith('/tasks')).length;
    const before = requests();
    expect(screen.getByRole('button', { name: 'Retry tasks' })).toBeDisabled();
    await act(() => jest.advanceTimersByTimeAsync(30_000));
    expect(requests()).toBe(before);
    await act(() => focusManager.setFocused(false));
    await act(() => focusManager.setFocused(true));
    expect(requests()).toBe(before);
    limited = false;
    await act(() => jest.advanceTimersByTimeAsync(270_000));
    await press('Retry tasks');
    await screen.findByText('Task 1');
  } finally {
    await env.dispose();
  }
});

test('permission revoke during a Card probe suppresses cached rows and prevents navigation', async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const env = await setup([row(1)], (url) =>
    url.pathname === `/api/boards/${boardId}` ? pending : null,
  );
  try {
    await screen.findByText('Task 1');
    await press(/^Open Task 1,/);
    await act(() => {
      env.data.resources.fenceBoard(boardId, true);
      env.data.evict(env.data.getIdentity(), [
        queryKeys.tasks(env.data.getIdentity()),
      ]);
    });
    await act(() =>
      finish(
        ok({
          id: boardId,
          workspaceId,
          isArchived: false,
          capabilities: { canReadBoard: true, canWriteBoard: true },
        }),
      ),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.queryByText('Task 1')).toBeNull();
  } finally {
    await env.dispose();
  }
});

test('filter sheet sends Board labels with OR, saved-zone civil dates and server sort', async () => {
  const env = await setup([row(1)]);
  try {
    await screen.findByText('Task 1');
    await press('Filter and sort tasks');
    await press('Board 1');
    await press('Review');
    await press('Due from: Any date');
    await act(() =>
      DateTimePickerAndroid.open.mock.calls
        .at(-1)[0]
        .onValueChange({}, new Date('2026-03-08T00:00:00Z')),
    );
    await press('Due through: Any date');
    await act(() =>
      DateTimePickerAndroid.open.mock.calls
        .at(-1)[0]
        .onValueChange({}, new Date('2026-03-08T00:00:00Z')),
    );
    await press('Recently updated');
    await press('Apply filters');
    await waitFor(() => {
      const { url } = env.requests
        .filter(({ url }) => url.pathname.endsWith('/tasks'))
        .at(-1);
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        page: '1',
        limit: '20',
        sort: 'updatedAt',
        boardId,
        labelIds: uuid(42),
        dueFrom: '2026-03-08T05:00:00.000Z',
        dueTo: '2026-03-09T04:00:00.000Z',
      });
    });
    await press('Filter and sort tasks');
    await press('All boards');
    expect(
      screen.queryByRole('button', { name: 'Clear selected labels' }),
    ).toBeNull();
    await press('Reset filters');
    await press('Apply filters');
    await waitFor(() => {
      const { url } = env.requests
        .filter(({ url }) => url.pathname.endsWith('/tasks'))
        .at(-1);
      expect(url.searchParams.get('sort')).toBe('dueDate');
      expect(url.searchParams.get('boardId')).toBeNull();
    });
  } finally {
    await env.dispose();
  }
});

test('filter Back guards unsaved changes and rejects inverted due days before a task request', async () => {
  const env = await setup([row(1)]);
  try {
    await screen.findByText('Task 1');
    const before = env.requests.filter(({ url }) =>
      url.pathname.endsWith('/tasks'),
    ).length;
    await press('Filter and sort tasks');
    await press('Due from: Any date');
    await act(() =>
      DateTimePickerAndroid.open.mock.calls
        .at(-1)[0]
        .onValueChange({}, new Date('2026-03-10T00:00:00Z')),
    );
    await press('Due through: Any date');
    await act(() =>
      DateTimePickerAndroid.open.mock.calls
        .at(-1)[0]
        .onValueChange({}, new Date('2026-03-08T00:00:00Z')),
    );
    await press('Apply filters');
    await screen.findByText('Due from must be on or before due through.');
    expect(
      env.requests.filter(({ url }) => url.pathname.endsWith('/tasks')),
    ).toHaveLength(before);
    await fireEvent(screen.getByTestId('task-modal'), 'touchEnd');
    await screen.findByText('Discard filter changes?');
    await press('Keep editing');
    expect(
      screen.getByRole('button', { name: 'Due from: 2026-03-10' }),
    ).toBeTruthy();
    await press('Cancel');
    await press('Discard changes');
    expect(screen.queryByTestId('task-modal')).toBeNull();
  } finally {
    await env.dispose();
  }
});
