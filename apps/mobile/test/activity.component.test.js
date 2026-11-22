/* global jest, test, expect, afterEach */
import { URL } from 'node:url';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { onlineManager, focusManager } from '@tanstack/react-query';
import { useColorScheme, useWindowDimensions, StyleSheet } from 'react-native';
import { ActivityScreen } from '../src/features/activity/ActivityScreen';
import { createHttpClient } from '../src/infrastructure/api/client';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { createSessionManager } from '../src/infrastructure/auth/session-manager';
import { createCredentialStore } from '../src/infrastructure/auth/credential-store';
import { createMobileDataLayer } from '../src/infrastructure/query/data-layer';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { createNativeRealtime } from '../src/infrastructure/realtime/client';
import { RealtimeProvider } from '../src/infrastructure/realtime/RealtimeProvider';
import { SessionProvider as NavigationProvider } from '../src/navigation/session-context';
import { createNavigationSessionAdapter } from '../src/navigation/native-session-adapter';
import { activityKeys } from '../src/features/activity/keys';
import { queryKeys } from '../src/infrastructure/query/keys';
import { ThemeContext, palettes } from '../src/ui';
import {
  FakeSessionApi,
  FakeTime,
  MemorySecureStore,
  USER_A,
  USER_B,
  loginResponse,
  user,
  deferred,
} from './auth/support';
import { page, uuid } from './workspaces/fixtures';
import { cardDto } from './workspaces/kanban-fixtures';
import {
  activityBoard,
  activityWorkspace,
  boardEvent,
  boardId,
  workspaceEvent,
  workspaceId,
} from './activity/fixtures';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockRouter = { push: mockPush, replace: mockReplace };
let mockFocus = true;
let mockScope = 'workspace';
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useIsFocused: () => mockFocus,
  usePathname: () =>
    mockScope === 'board'
      ? `/boards/00000000-0000-4000-8000-0000000003e9/activity`
      : '/workspaces/00000000-0000-4000-8000-000000000001/activity',
  Stack: { Screen: () => null },
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  const descriptors = Object.getOwnPropertyDescriptors(native);
  descriptors.useColorScheme = {
    configurable: true,
    value: jest.fn(() => 'light'),
  };
  descriptors.useWindowDimensions = {
    configurable: true,
    value: jest.fn(() => ({
      width: 320,
      height: 700,
      scale: 1,
      fontScale: 1.6,
    })),
  };
  return Object.create(Object.getPrototypeOf(native), descriptors);
});
const response = (payload, status = 200, retryAfter) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {
    get: (name) =>
      name === 'content-type'
        ? 'application/json'
        : name === 'retry-after'
          ? (retryAfter ?? null)
          : null,
  },
  text: async () => JSON.stringify(payload),
});
const ok = (data) =>
  response({ success: true, statusCode: 200, message: 'OK', data });
const fail = (status, retryAfter) =>
  response(
    {
      success: false,
      statusCode: status,
      code: 'REQUEST_FAILED',
      message: 'Request failed',
    },
    status,
    retryAfter,
  );
afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
});

async function setup({
  scope = 'workspace',
  count = 1,
  theme = 'light',
  override,
  seed,
  patch,
  configureRealtime,
} = {}) {
  mockScope = scope;
  mockFocus = true;
  mockPush.mockClear();
  mockReplace.mockClear();
  useColorScheme.mockReturnValue('light');
  useWindowDimensions.mockReturnValue({
    width: 320,
    height: 700,
    scale: 1,
    fontScale: 1.6,
  });
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
  const state = {
    workspace: activityWorkspace(),
    board: activityBoard(),
    rows: Array.from({ length: count }, (_, i) =>
      scope === 'workspace' ? workspaceEvent(i) : boardEvent(i),
    ),
    status: 200,
    accessStatus: 200,
  };
  patch?.(state);
  const calls = [];
  const fetch = async (input, init) => {
    const url = new URL(input);
    const call = {
      path: url.pathname,
      page: Number(url.searchParams.get('page')),
      limit: Number(url.searchParams.get('limit')),
      signal: init.signal,
    };
    calls.push(call);
    const custom = await override?.(call, state);
    if (custom) return custom;
    if (call.path === '/api/users/me/preferences')
      return ok({
        theme: 'light',
        timeZone: 'Asia/Bangkok',
        dateFormat: 'DD/MM/YYYY',
        weekStartsOn: 'monday',
      });
    if (call.path === `/api/workspaces/${workspaceId}`)
      return state.accessStatus === 200
        ? ok(state.workspace)
        : fail(state.accessStatus);
    if (call.path === `/api/boards/${boardId}`)
      return state.accessStatus === 200
        ? ok(state.board)
        : fail(state.accessStatus);
    if (call.path.endsWith('/activity') || call.path.endsWith('/activities'))
      return state.status === 200
        ? response(page(state.rows, call.page, call.limit))
        : fail(state.status, state.status === 429 ? '60' : undefined);
    if (call.path.endsWith(`/cards/${uuid(3001)}`)) return ok(cardDto(1));
    return fail(404);
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
  configureRealtime?.(realtime, data);
  const navigation = createNavigationSessionAdapter(manager);
  const view = () => (
    <ThemeContext value={theme}>
      <SessionProvider manager={manager}>
        <DataProvider layer={data}>
          <RealtimeProvider client={realtime}>
            <NavigationProvider adapter={navigation}>
              <ActivityScreen
                scope={scope}
                id={scope === 'workspace' ? workspaceId : boardId}
              />
            </NavigationProvider>
          </RealtimeProvider>
        </DataProvider>
      </SessionProvider>
    </ThemeContext>
  );
  const tree = await render(view());
  return {
    state,
    calls,
    data,
    manager,
    tree,
    view,
    async dispose() {
      await tree.unmount();
      realtime.dispose();
      data.dispose();
      manager.dispose();
    },
  };
}

test('a stopped checking room can retry through realtime without exposing activity', async () => {
  let snapshot = {
    status: 'checking',
    canRead: false,
    canWrite: false,
    userIds: [],
  };
  const listeners = new Set();
  let pending = deferred();
  const retry = jest.fn(async () => {
    if (!(await pending.promise))
      throw new Error('Temporary verification failure');
  });
  const env = await setup({
    scope: 'board',
    configureRealtime: (realtime, data) => {
      data.resources.fenceBoard(boardId);
      realtime.getBoardSnapshot = () => snapshot;
      realtime.subscribeBoards = (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      };
      realtime.watchBoard = () => () => {};
      realtime.retryBoard = retry;
    },
  });
  try {
    const button = screen.getByRole('button', { name: 'Check Board access' });
    expect(button.props.accessibilityState.disabled).toBe(false);
    await fireEvent.press(button);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Check Board access' }),
    );
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith(boardId);
    expect(screen.queryByText('Someone updated a card')).toBeNull();
    expect(env.calls.some((call) => call.path.endsWith('/activities'))).toBe(
      false,
    );
    await act(() => pending.resolve(false));
    expect(
      screen.getByRole('button', { name: 'Check Board access' }).props
        .accessibilityState.disabled,
    ).toBe(false);
    pending = deferred();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Check Board access' }),
    );
    expect(retry).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Someone updated a card')).toBeNull();
    await act(() => {
      env.data.resources.confirmBoard(boardId, false, workspaceId);
      snapshot = { ...snapshot, status: 'paused', canRead: true };
      listeners.forEach((listener) => listener());
      pending.resolve(true);
    });
    await waitFor(() =>
      expect(screen.getByText('Someone updated a card')).toBeTruthy(),
    );
  } finally {
    await env.dispose();
  }
});

for (const scope of ['workspace', 'board'])
  for (const count of [0, 1, 20, 21, 501])
    test(`${scope} timeline presents ${count} server events with bounded pagination`, async () => {
      const env = await setup({ scope, count });
      try {
        await waitFor(() =>
          expect(
            screen.getByText(
              `${count} events · Page 1 of ${Math.max(1, Math.ceil(count / 20))}`,
            ),
          ).toBeTruthy(),
        );
        if (!count) expect(screen.getByText('No activity yet')).toBeTruthy();
        expect(
          env.calls.filter(
            (c) =>
              c.path.endsWith('/activity') || c.path.endsWith('/activities'),
          ),
        ).toHaveLength(1);
        if (count > 20) {
          await fireEvent.press(
            screen.getByRole('button', { name: 'Older activity' }),
          );
          await waitFor(() =>
            expect(
              screen.getByText(
                `${count} events · Page 2 of ${Math.ceil(count / 20)}`,
              ),
            ).toBeTruthy(),
          );
          expect(
            env.calls.filter(
              (c) =>
                c.path.endsWith('/activity') || c.path.endsWith('/activities'),
            ),
          ).toHaveLength(2);
          await fireEvent.press(
            screen.getByRole('button', { name: 'Newer activity' }),
          );
          await waitFor(() =>
            expect(
              screen.getByText(
                `${count} events · Page 1 of ${Math.ceil(count / 20)}`,
              ),
            ).toBeTruthy(),
          );
        }
        expect(env.calls.some((c) => c.path.endsWith('/members'))).toBe(false);
      } finally {
        await env.dispose();
      }
    });

test('long names at 320dp/160% fonts use themed growing rows and accessible exact timestamps', async () => {
  for (const theme of ['light', 'dark', 'system']) {
    const env = await setup({
      theme,
      patch: (state) => {
        state.rows[0].actor.displayName = 'Long verified actor '.repeat(8);
      },
    });
    try {
      await waitFor(() =>
        expect(
          screen.getByText(/Long verified actor .*updated the workspace/),
        ).toBeTruthy(),
      );
      const heading = screen.getByRole('header', {
        name: 'Workspace activity',
      });
      expect(StyleSheet.flatten(heading.props.style).color).toBe(
        palettes[theme === 'system' ? 'light' : theme].text,
      );
      const row = screen.getByLabelText(/2026-11-18T10:00:00.000Z/);
      expect(row).toBeTruthy();
      await waitFor(() =>
        expect(
          env.data.queryClient.getQueryData(
            queryKeys.datePreferences(env.data.getIdentity()),
          ),
        ).toMatchObject({
          theme: 'light',
          timeZone: 'Asia/Bangkok',
          dateFormat: 'DD/MM/YYYY',
          weekStartsOn: 'monday',
        }),
      );
      expect(
        screen.queryByText(
          'Until date preferences are available, timestamps use UTC.',
        ),
      ).toBeNull();
      const text = screen.getByText(
        /Long verified actor .*updated the workspace/,
      );
      expect(text.props.numberOfLines).toBeUndefined();
      expect(text.props.allowFontScaling).not.toBe(false);
      expect(
        screen.getByRole('button', { name: 'Refresh activity' }).props
          .accessibilityState.disabled,
      ).toBe(false);
    } finally {
      await env.dispose();
    }
  }
});

test('hidden invitation and nonmember MEMBER pages fail closed without leaking names or counts', async () => {
  for (const scope of ['workspace', 'board']) {
    const env = await setup({
      scope,
      patch: (state) => {
        state.rows[0] =
          scope === 'workspace'
            ? {
                ...workspaceEvent(),
                eventType: 'INVITATION_REQUESTED',
                actor: {
                  id: USER_A,
                  displayName: 'Secret actor',
                  avatarUrl: null,
                },
              }
            : {
                ...boardEvent(),
                entityType: 'MEMBER',
                metadata: { email: 'secret@example.test' },
              };
      },
    });
    try {
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Retry activity' }),
        ).toBeTruthy(),
      );
      expect(
        screen.queryByText(/Secret actor|secret@example|1 events/),
      ).toBeNull();
    } finally {
      await env.dispose();
    }
  }
});

test('deleted/null actors and Board context use neutral fallbacks with no private avatar images', async () => {
  const env = await setup({
    patch: (state) => {
      state.rows = [
        {
          ...workspaceEvent(),
          eventType: 'BOARD_MOVED',
          actor: null,
          board: null,
        },
      ];
    },
  });
  try {
    await waitFor(() =>
      expect(
        screen.getByText('Someone moved a board into the workspace'),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/Board unavailable/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Open/ })).toBeNull();
  } finally {
    await env.dispose();
  }
});

test('offline and 429 disable paging/retry; background 503 keeps already authorized content', async () => {
  const env = await setup({ count: 21 });
  try {
    await waitFor(() =>
      expect(screen.getByText('21 events · Page 1 of 2')).toBeTruthy(),
    );
    await act(() => onlineManager.setOnline(false));
    expect(
      screen.getByRole('button', { name: 'Older activity' }).props
        .accessibilityState.disabled,
    ).toBe(true);
    expect(screen.getByText(/You’re offline/)).toBeTruthy();
    await act(() => onlineManager.setOnline(true));
    env.state.status = 503;
    await fireEvent.press(
      screen.getByRole('button', { name: 'Refresh activity' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry activity' }),
      ).toBeTruthy(),
    );
    expect(
      screen.getAllByText('Verified actor updated the workspace').length,
    ).toBeGreaterThan(0);
    env.state.status = 429;
    await fireEvent.press(
      screen.getByRole('button', { name: 'Retry activity' }),
    );
    await waitFor(() =>
      expect(
        screen.getByText('Too many requests. Try again shortly.'),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole('button', { name: 'Retry activity' }).props
        .accessibilityState.disabled,
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Older activity' }).props
        .accessibilityState.disabled,
    ).toBe(true);
  } finally {
    await env.dispose();
  }
});

test('valid Card navigation rechecks access; deleted resources show unavailable and never push', async () => {
  let deleted = false;
  const env = await setup({
    scope: 'board',
    override: (call) =>
      call.path.includes('/cards/') && deleted ? fail(404) : undefined,
  });
  try {
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Open card/ })).toBeTruthy(),
    );
    await fireEvent.press(screen.getByRole('button', { name: /^Open card/ }));
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        `/boards/${boardId}/cards/${uuid(3001)}`,
      ),
    );
    mockPush.mockClear();
    deleted = true;
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^Open card/ }).props
          .accessibilityState.disabled,
      ).toBe(false),
    );
    await fireEvent.press(screen.getByRole('button', { name: /^Open card/ }));
    await waitFor(() =>
      expect(
        screen.getByText(/Item unavailable\. Refresh activity/),
      ).toBeTruthy(),
    );
    expect(mockPush).not.toHaveBeenCalled();
  } finally {
    await env.dispose();
  }
});

test('Back/blur cancels pending navigation and removes old rows before return; session switch clears all pages', async () => {
  const pending = deferred();
  const env = await setup({
    scope: 'board',
    override: (call) =>
      call.path.includes('/cards/') ? pending.promise : undefined,
  });
  try {
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Open card/ })).toBeTruthy(),
    );
    await fireEvent.press(screen.getByRole('button', { name: /^Open card/ }));
    await waitFor(() =>
      expect(screen.getByText('Checking item access…')).toBeTruthy(),
    );
    mockFocus = false;
    await env.tree.rerender(env.view());
    await act(() => pending.resolve(ok(cardDto(1))));
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByText('Someone updated a card')).toBeNull();
    mockFocus = true;
    await env.tree.rerender(env.view());
    await waitFor(() =>
      expect(screen.getByText('Someone updated a card')).toBeTruthy(),
    );
    const previous = env.data.getIdentity();
    await act(() => env.manager.establishSession(loginResponse(USER_B)));
    expect(
      env.data.queryClient.getQueriesData({
        queryKey: activityKeys.board(previous, boardId),
      }),
    ).toHaveLength(0);
  } finally {
    await env.dispose();
  }
});

test('membership denial purges protected content and replaces the route with Boards', async () => {
  const env = await setup();
  try {
    await waitFor(() =>
      expect(
        screen.getByText('Verified actor updated the workspace'),
      ).toBeTruthy(),
    );
    env.state.accessStatus = 404;
    await fireEvent.press(
      screen.getByRole('button', { name: 'Refresh activity' }),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/boards'));
    expect(
      screen.queryByText('Verified actor updated the workspace'),
    ).toBeNull();
    expect(
      env.data.resources.readable(
        queryKeys.workspace(env.data.getIdentity(), workspaceId),
      ),
    ).toBe(false);
  } finally {
    await env.dispose();
  }
});

test('a denied Board probe revokes the resource grant and returns to Boards', async () => {
  const env = await setup({ scope: 'board' });
  try {
    await waitFor(() =>
      expect(screen.getByText('Someone updated a card')).toBeTruthy(),
    );
    env.state.accessStatus = 404;
    await fireEvent.press(
      screen.getByRole('button', { name: 'Refresh activity' }),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/boards'));
    expect(screen.queryByText('Someone updated a card')).toBeNull();
    expect(
      env.data.resources.readable(
        queryKeys.board(env.data.getIdentity(), boardId),
      ),
    ).toBe(false);
  } finally {
    await env.dispose();
  }
});

test('server count shrinking on an older page returns to a valid page without concatenating snapshots', async () => {
  const env = await setup({ count: 21 });
  try {
    await waitFor(() =>
      expect(screen.getByText('21 events · Page 1 of 2')).toBeTruthy(),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Older activity' }),
    );
    await waitFor(() =>
      expect(screen.getByText('21 events · Page 2 of 2')).toBeTruthy(),
    );
    env.state.rows = [workspaceEvent()];
    await fireEvent.press(
      screen.getByRole('button', { name: 'Refresh activity' }),
    );
    await waitFor(() =>
      expect(screen.getByText('1 events · Page 1 of 1')).toBeTruthy(),
    );
    expect(
      screen.getAllByText('Verified actor updated the workspace'),
    ).toHaveLength(1);
  } finally {
    await env.dispose();
  }
});
