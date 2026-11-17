/* global jest, test, expect, console */
import React from 'react';
import { URL } from 'node:url';
import {
  Appearance,
  Dimensions,
  Platform,
  StyleSheet,
  Text,
} from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Stack, Tabs, router, useRouter } from 'expo-router';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
  waitFor,
  within,
} from 'expo-router/testing-library';
import { onlineManager } from '@tanstack/react-query';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { createSessionManager } from '../src/infrastructure/auth/session-manager';
import { createCredentialStore } from '../src/infrastructure/auth/credential-store';
import { createHttpClient } from '../src/infrastructure/api/client';
import { createMobileDataLayer } from '../src/infrastructure/query/data-layer';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { queryKeys } from '../src/infrastructure/query/keys';
import { createNativeRealtime } from '../src/infrastructure/realtime/client';
import { RealtimeProvider } from '../src/infrastructure/realtime/RealtimeProvider';
import { SessionProvider as NavigationProvider } from '../src/navigation/session-context';
import { createNavigationSessionAdapter } from '../src/navigation/native-session-adapter';
import { redirectSystemPath } from '../src/app/+native-intent';
import PrivateLayout from '../src/app/(private)/_layout';
import CardRoute from '../src/app/(private)/boards/[boardId]/cards/[cardId]';
import BoardRoute from '../src/app/(private)/boards/[boardId]/index';
import { CardDetailScreen } from '../src/features/cards/detail/CardDetailScreen';
import { Button, palettes, resolveTheme, ThemeContext } from '../src/ui';
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
  boardDetail,
  boardId,
  cardDto,
  column,
  preview,
  timestamp,
} from './workspaces/kanban-fixtures';
import { page, uuid, workspace } from './workspaces/fixtures';
import { FakeSocket } from './realtime/support';
import { checklist, checklists, itemCounts } from './fixtures/checklists.ts';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true }),
  addNetworkStateListener: () => ({ remove() {} }),
}));
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: {
    open: jest.fn(),
    dismiss: jest.fn(async () => true),
  },
}));
jest.mock(
  'expo-glass-effect',
  () => ({ isLiquidGlassAvailable: () => false }),
  { virtual: true },
);
jest.mock(
  'expo-asset',
  () => ({ Asset: { fromModule: () => ({ downloadAsync: async () => {} }) } }),
  { virtual: true },
);
jest.spyOn(React, 'useEffectEvent').mockImplementation((callback) => {
  const latest = React.useRef(callback);
  React.useEffect(() => {
    latest.current = callback;
  });
  return React.useCallback((...args) => latest.current(...args), []);
});

const cardPath = `/boards/${boardId}/cards/${cardDto(1).id}`;
const success = (data, status = 200) =>
  response({ success: true, statusCode: status, message: 'OK', data }, status);
function response(data, status = 200, retryAfter = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name) =>
        name === 'content-type'
          ? 'application/json'
          : name === 'retry-after'
            ? retryAfter
            : null,
    },
    text: async () => JSON.stringify(data),
  };
}
const fail = (status, code = 'CARD_ERROR', retryAfter) =>
  response(
    {
      success: false,
      statusCode: status,
      message: 'Card request failed.',
      code,
      details: [],
    },
    status,
    retryAfter,
  );

async function setup({
  initialUrl = cardPath,
  mode = 'light',
  archived = false,
  readOnly = false,
  sections,
  override,
  liveSocket = false,
} = {}) {
  onlineManager.setOnline(true);
  let card = {
    ...cardDto(1),
    description: 'Original\nsecond line',
    isArchived: archived,
    archivedAt: archived ? timestamp : null,
  };
  let board = {
    ...boardDetail,
    capabilities: { ...boardDetail.capabilities, canWriteBoard: !readOnly },
  };
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
  const data = createMobileDataLayer(
    manager,
    createHttpClient({
      baseUrl: new URL('https://example.test/api'),
      clock: time,
      timers: time,
      isOnline: () => onlineManager.isOnline(),
      fetch: async (input, init) => {
        const url = new URL(input);
        const request = {
          path: url.pathname,
          page: Number(url.searchParams.get('page')) || 1,
          method: init.method,
          body: init.body ? JSON.parse(init.body) : undefined,
          signal: init.signal,
        };
        requests.push(request);
        const custom = override?.(request, { card, board });
        if (custom) return custom;
        const n = Number(url.searchParams.get('page')) || 1;
        if (url.pathname === '/api/users/me') return success(user(USER_A));
        if (url.pathname === `/api/boards/${boardId}`) return success(board);
        if (url.pathname.endsWith('/columns'))
          return response(page([column(1), column(2)], n, 100));
        if (url.pathname.endsWith('/cards'))
          return response(page([card], n, 100));
        if (url.pathname === `/api${cardPath}/labels`)
          return success({ cardId: card.id, labels: [] });
        if (url.pathname.endsWith('/preferences'))
          return success({ timeZone: 'UTC', dateFormat: 'YYYY-MM-DD' });
        if (
          url.pathname.endsWith('/labels') ||
          url.pathname.endsWith('/members')
        )
          return response(page([], n, 100));
        if (url.pathname.endsWith('/card-preview-summaries'))
          return success({ summaries: [preview(card.id)] });
        if (
          url.pathname.endsWith('/user-state') ||
          url.pathname.endsWith('/views')
        )
          return success({ isStarred: false, lastViewedAt: null });
        if (url.pathname.startsWith('/api/workspaces/'))
          return success(workspace());
        if (url.pathname === `/api${cardPath}`) {
          if (init.method === 'PATCH') card = { ...card, ...request.body };
          return success(card);
        }
        if (url.pathname.endsWith('/archive')) {
          card = { ...card, isArchived: true, archivedAt: timestamp };
          return success(card);
        }
        if (url.pathname.endsWith('/restore')) {
          card = { ...card, isArchived: false, archivedAt: null };
          return success(card);
        }
        if (url.pathname.endsWith('/move')) {
          card = { ...card, columnId: request.body.toColumnId };
          return success(card);
        }
        return fail(404);
      },
    }),
    time,
  );
  const sockets = [];
  const realtime = createNativeRealtime({
    manager,
    data,
    createSocket: liveSocket
      ? (credential) => {
          const socket = new FakeSocket(credential);
          sockets.push(socket);
          return socket;
        }
      : null,
    timers: time,
  });
  const adapter = createNavigationSessionAdapter(manager);
  function Home() {
    const navigate = useRouter();
    return (
      <Button
        label="Open card from Home"
        onPress={() => navigate.push(cardPath)}
      />
    );
  }
  const routes = {
    _layout: () => (
      <SessionProvider manager={manager}>
        <DataProvider layer={data}>
          <RealtimeProvider client={realtime}>
            <NavigationProvider adapter={adapter}>
              <ThemeContext.Provider value={mode}>
                <Stack />
              </ThemeContext.Provider>
            </NavigationProvider>
          </RealtimeProvider>
        </DataProvider>
      </SessionProvider>
    ),
    '(private)/_layout': {
      default: PrivateLayout,
      unstable_settings: { anchor: '(tabs)' },
    },
    '(private)/(tabs)/_layout': () => (
      <Tabs>
        <Tabs.Screen name="home" />
        <Tabs.Screen name="tasks" />
        <Tabs.Screen name="boards" />
        <Tabs.Screen name="inbox" />
      </Tabs>
    ),
    '(private)/(tabs)/home': Home,
    '(private)/(tabs)/tasks': () => <Text>Tasks destination</Text>,
    '(private)/(tabs)/boards': () => (
      <Button
        label="Open Board"
        onPress={() => router.push(`/boards/${boardId}`)}
      />
    ),
    '(private)/(tabs)/inbox': () => <Text>Inbox destination</Text>,
    '(private)/boards/[boardId]/index': BoardRoute,
    '(private)/invitation': () => null,
    '(private)/boards/[boardId]/cards/[cardId]': sections
      ? () => (
          <CardDetailScreen
            boardId={boardId}
            cardId={cardDto(1).id}
            sections={sections}
          />
        )
      : CardRoute,
    'sign-in': () => <Text>Signed out safely</Text>,
  };
  const view = await renderRouter(routes, { initialUrl });
  return {
    data,
    time,
    sockets,
    manager,
    realtime,
    requests,
    patches: () => requests.filter(({ method }) => method === 'PATCH'),
    async remote(patch) {
      card = { ...card, ...patch };
      await act(() =>
        data.invalidate(data.getIdentity(), [
          queryKeys.card(data.getIdentity(), boardId, card.id),
        ]),
      );
    },
    serverOnly(patch) {
      card = { ...card, ...patch };
    },
    serverBoard(patch) {
      board = { ...board, ...patch };
    },
    async board(patch) {
      board = { ...board, ...patch };
      await act(() =>
        data.invalidate(data.getIdentity(), [
          queryKeys.board(data.getIdentity(), boardId),
        ]),
      );
    },
    async dispose() {
      await view.unmount();
      realtime.dispose();
      data.dispose();
      manager.dispose();
      onlineManager.setOnline(true);
    },
  };
}
const press = async (name) =>
  fireEvent.press(await screen.findByRole('button', { name }));
async function editDescription(value) {
  await press('Edit description');
  await fireEvent.changeText(screen.getByLabelText('Description'), value);
}

test('authorized cold link renders the verified Board/Column/Card, safe plain text and missing sections without fictitious actions', async () => {
  const env = await setup();
  try {
    await screen.findByText('Card 1');
    await screen.findByText('Product Roadmap › Column 1');
    expect(screen.getByText('Original\nsecond line')).toBeTruthy();
    expect(screen.queryByText('Attachments')).toBeNull();
    expect(screen.queryByText('High Priority')).toBeNull();
    expect(screen.getByText('Unassigned')).toBeTruthy();
    expect(env.requests.some(({ path }) => path.endsWith('/columns'))).toBe(
      true,
    );
    await env.remote({
      description:
        '<script>alert(1)</script>\n[javascript](javascript:alert(1))',
    });
    await screen.findByText(
      '<script>alert(1)</script>\n[javascript](javascript:alert(1))',
    );
    expect(screen.getByTestId('card-detail-keyboard')).toBeTruthy();
    expect(
      screen.getByTestId('card-detail-scroll').props.keyboardShouldPersistTaps,
    ).toBe('handled');
  } finally {
    await env.dispose();
  }
});

test('Save/Cancel, normalized no-op, explicit null-clear, title edit and reconciliation use one adapter', async () => {
  const env = await setup();
  try {
    await editDescription('  Original\nsecond line  ');
    await press('Save description');
    expect(env.patches()).toHaveLength(0);
    await editDescription('cancelled value');
    await press('Cancel');
    expect(env.patches()).toHaveLength(0);
    await editDescription('  \n ');
    await press('Save description');
    await screen.findByText('No description');
    expect(env.patches().map(({ body }) => body)).toEqual([
      { description: null },
    ]);
    await press('Edit title');
    await fireEvent.changeText(
      screen.getByLabelText('Card title'),
      ' New title ',
    );
    await press('Save title');
    await screen.findByText('New title');
    expect(env.patches().at(-1).body).toEqual({
      title: 'New title',
      expectedTitle: 'Card 1',
    });
  } finally {
    await env.dispose();
  }
});

test('remote field conflict requires explicit keep/load, unrelated changes preserve input and max length blocks HTTP', async () => {
  const env = await setup();
  try {
    await editDescription('mine');
    await env.remote({ title: 'Other metadata edit' });
    await screen.findByText('Other metadata edit');
    expect(screen.queryByRole('button', { name: 'Load latest' })).toBeNull();
    expect(screen.getByLabelText('Description').props.value).toBe('mine');
    await env.remote({ description: 'theirs' });
    await screen.findByRole('button', { name: 'Load latest' });
    expect(
      screen.queryByRole('button', { name: 'Save description' }),
    ).toBeNull();
    await press('Load latest');
    expect(screen.getByLabelText('Description').props.value).toBe('theirs');
    await fireEvent.changeText(
      screen.getByLabelText('Description'),
      'mine again',
    );
    await env.remote({ description: 'theirs again' });
    await press('Keep mine and save');
    await screen.findByText('mine again');
    expect(env.patches().map(({ body }) => body)).toEqual([
      { description: 'mine again' },
    ]);
    await editDescription('a'.repeat(2001));
    expect(
      screen.getByRole('button', { name: 'Save description' }),
    ).toBeDisabled();
    expect(env.patches()).toHaveLength(1);
  } finally {
    await env.dispose();
  }
});

test.each([400, 409, 429, 500])(
  'PATCH %s retains the exact draft and permits cancel',
  async (status) => {
    const env = await setup({
      override: (r) =>
        r.method === 'PATCH'
          ? fail(status, 'CARD_ERROR', status === 429 ? '60' : null)
          : null,
    });
    try {
      await editDescription('unsaved private text');
      await press('Save description');
      await waitFor(() =>
        expect(screen.getByLabelText('Description').props.editable).toBe(true),
      );
      expect(screen.getByLabelText('Description').props.value).toBe(
        'unsaved private text',
      );
      expect(env.patches()).toHaveLength(1);
      if (status === 429)
        expect(
          screen.getByRole('button', { name: 'Save description' }),
        ).toBeDisabled();
      await press('Cancel');
      await screen.findByText('Original\nsecond line');
    } finally {
      await env.dispose();
    }
  },
);

test.each([403, 404])(
  'Card PATCH %s hides private draft without revoking a Board that still passes GET',
  async (status) => {
    const env = await setup({
      override: (r) => (r.method === 'PATCH' ? fail(status) : null),
    });
    try {
      await editDescription('private draft');
      await press('Save description');
      await screen.findByText('This destination is unavailable.');
      expect(screen.queryByDisplayValue('private draft')).toBeNull();
      expect(
        env.data.resources.readable(
          queryKeys.board(env.data.getIdentity(), boardId),
        ),
      ).toBe(true);
    } finally {
      await env.dispose();
    }
  },
);

test('401 clears private screen and old 200 after account switch cannot render', async () => {
  let reject = true;
  const held = deferred();
  const env = await setup({
    override: (r) =>
      r.method === 'PATCH' ? (reject ? fail(401) : held.promise) : null,
  });
  try {
    await editDescription('secret');
    await press('Save description');
    await screen.findByText('Signed out safely');
    expect(env.data.getIdentity()).toBeNull();
    reject = false;
    await act(() => env.manager.establishSession(loginResponse(USER_A)));
    await act(() => router.replace(cardPath));
    await editDescription('late secret');
    await press('Save description');
    await act(() => env.manager.establishSession(loginResponse(USER_B)));
    await act(() =>
      held.resolve(success({ ...cardDto(1), description: 'late secret' })),
    );
    expect(screen.queryByText('late secret')).toBeNull();
    expect(screen.queryByDisplayValue('late secret')).toBeNull();
  } finally {
    held.resolve(fail(401));
    await env.dispose();
  }
});

test.each(['card', 'board', 'acl'])(
  '%s read-only transition retains readable unsaved text and blocks writes',
  async (kind) => {
    const env = await setup();
    try {
      await editDescription('copyable unsaved');
      if (kind === 'card')
        await env.remote({ isArchived: true, archivedAt: timestamp });
      else if (kind === 'board')
        await env.board({ isArchived: true, archivedAt: timestamp });
      else
        await env.board({
          capabilities: { ...boardDetail.capabilities, canWriteBoard: false },
        });
      await screen.findByText(
        'Editing is unavailable. Your unsaved text is kept here until you cancel or leave.',
      );
      expect(
        screen.getByRole('button', { name: 'Save description' }),
      ).toBeDisabled();
      expect(screen.getByText('copyable unsaved').props.selectable).toBe(true);
      expect(env.patches()).toHaveLength(0);
    } finally {
      await env.dispose();
    }
  },
);

test('Back, tab replacement and warm deep link prompt Keep editing/Discard using real Expo Router prevention', async () => {
  const env = await setup({ initialUrl: '/home' });
  try {
    await press('Open card from Home');
    await editDescription('dirty');
    await press('Back');
    await screen.findByText('Discard changes?');
    await press('Keep editing');
    expect(screen.getByLabelText('Description').props.value).toBe('dirty');
    await act(() => router.replace('/tasks'));
    await screen.findByText('Discard changes?');
    await press('Keep editing');
    let redirected;
    await act(() => {
      redirected = redirectSystemPath({
        path: 'https://kanvexa.tech/inbox',
        initial: false,
      });
    });
    expect(redirected).toBe(cardPath);
    await screen.findByText('Discard changes?');
    await press('Keep editing');
    await press('Back');
    await press('Discard');
    await waitFor(() => expect(screen).toHavePathname('/home'));
  } finally {
    await env.dispose();
  }
});

test('late permission loss clears content and aborts pending save; no double submission', async () => {
  const held = deferred();
  const env = await setup({
    override: (r) => (r.method === 'PATCH' ? held.promise : null),
  });
  try {
    await editDescription('pending private draft');
    await press('Save description');
    await waitFor(() => expect(env.patches()).toHaveLength(1));
    expect(
      screen.getByRole('button', { name: 'Save description' }),
    ).toBeDisabled();
    await act(() => env.realtime.revokeBoard(boardId));
    await screen.findByText('This destination is unavailable.');
    await act(() =>
      held.resolve(
        success({ ...cardDto(1), description: 'pending private draft' }),
      ),
    );
    expect(screen.queryByText('pending private draft')).toBeNull();
    expect(screen.queryByDisplayValue('pending private draft')).toBeNull();
  } finally {
    held.resolve(fail(404));
    await env.dispose();
  }
});

test.each(['light', 'dark'])(
  'optional sections mount independently and an error never blanks the %s root',
  async (mode) => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const captured = [];
    function Checklist({ context }) {
      captured.push(context);
      return <Text>Checklist fixture mounted</Text>;
    }
    function Broken() {
      throw new Error('private section failure');
    }
    const env = await setup({
      mode,
      sections: {
        Checklists: Checklist,
        Attachments: Broken,
        Comments: () => <Text>Comment fixture mounted</Text>,
      },
    });
    try {
      await screen.findByText('Checklist fixture mounted');
      expect(screen.getByText('Card 1')).toBeTruthy();
      expect(screen.getByText('Comment fixture mounted')).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Retry attachments' }),
      ).toBeTruthy();
      expect(captured.at(-1)).toMatchObject({
        boardId,
        cardId: cardDto(1).id,
        identity: { userId: USER_A },
        readOnly: false,
        canEdit: true,
      });
      expect(typeof captured.at(-1).refreshCard).toBe('function');
    } finally {
      await env.dispose();
      spy.mockRestore();
    }
  },
);

test('archive/restore and Move use existing MOB-17 sheets and commands', async () => {
  const env = await setup();
  try {
    await press('Move');
    await press('Column 2');
    await press('Move to end of column');
    await screen.findByText('Product Roadmap › Column 2');
    await press('Card actions');
    await press('Archive');
    await press('Archive card');
    await screen.findByText('Archived card · Read-only');
    expect(
      screen.queryByRole('button', { name: 'Edit description' }),
    ).toBeNull();
    await press('Restore card options');
    await press('Restore card');
    await screen.findByRole('button', { name: 'Edit description' });
    expect(
      env.requests.filter(
        ({ path, method }) => method === 'POST' && path.endsWith('/restore'),
      ),
    ).toHaveLength(1);
  } finally {
    await env.dispose();
  }
});

test('invalid IDs never fetch and a mismatched Board/Card DTO never renders protected title', async () => {
  const env = await setup({
    initialUrl: '/boards/not-a-uuid/cards/not-a-uuid',
  });
  try {
    await waitFor(() => expect(screen).toHavePathname('/boards'));
    expect(env.requests).toHaveLength(0);
  } finally {
    await env.dispose();
  }
  const wrong = await setup({
    override: (r) =>
      r.path === `/api${cardPath}`
        ? success({ ...cardDto(1), boardId: USER_B, title: 'Must not leak' })
        : null,
  });
  try {
    await screen.findByText('Couldn’t open card');
    expect(screen.queryByText('Must not leak')).toBeNull();
  } finally {
    await wrong.dispose();
  }
});

test('320dp with 160% fonts stacks metadata, wraps long title and preserves full editor value', async () => {
  const original = Dimensions.get('window');
  await act(() =>
    Dimensions.set({
      window: { width: 320, height: 640, scale: 1, fontScale: 1.6 },
    }),
  );
  const env = await setup({ mode: 'dark' });
  try {
    const title =
      'A long title that must wrap across multiple lines on a narrow screen with large fonts';
    await env.remote({
      title,
      assignees: [
        { userId: USER_B, assignedById: USER_A, createdAt: timestamp },
      ],
    });
    const titleNode = await screen.findByText(title);
    expect(titleNode.props.numberOfLines).toBeUndefined();
    expect(
      screen.getByTestId('card-detail-metadata-grid').props.style.flexDirection,
    ).toBe('column');
    expect(
      screen.getByLabelText('Assigned member').props.style.width,
    ).toBeCloseTo(38.4);
    await editDescription('word '.repeat(400));
    expect(screen.getByLabelText('Description').props.value).toHaveLength(2000);
    expect(
      screen.getByLabelText('Description').props.allowFontScaling,
    ).not.toBe(false);
  } finally {
    await env.dispose();
    await act(() => Dimensions.set({ window: original }));
  }
});

test.each(['network', 'timeout'])(
  '%s during PATCH retains draft without automatic replay',
  async (kind) => {
    const held = deferred();
    const env = await setup({
      override: (r) =>
        r.method === 'PATCH'
          ? kind === 'network'
            ? Promise.reject(new Error('native network failed'))
            : held.promise
          : null,
    });
    try {
      await editDescription('keep on failure');
      await press('Save description');
      await waitFor(() => expect(env.patches()).toHaveLength(1));
      if (kind === 'timeout') await act(() => env.time.advance(15_001));
      await waitFor(() =>
        expect(screen.getByLabelText('Description').props.editable).toBe(true),
      );
      expect(screen.getByLabelText('Description').props.value).toBe(
        'keep on failure',
      );
      expect(env.patches()).toHaveLength(1);
      await press('Cancel');
    } finally {
      held.resolve(fail(500));
      await env.dispose();
    }
  },
);

test('pre-save GET catches an unseen change, and a second change requires a new acknowledgement', async () => {
  const env = await setup();
  try {
    await editDescription('mine');
    env.serverOnly({ description: 'unseen change' });
    await press('Save description');
    await screen.findByRole('button', { name: 'Keep mine and save' });
    expect(env.patches()).toHaveLength(0);
    env.serverOnly({ description: 'changed twice' });
    await press('Keep mine and save');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Keep mine and save' }),
      ).not.toBeDisabled(),
    );
    expect(env.patches()).toHaveLength(0);
    await press('Keep mine and save');
    await screen.findByText('mine');
    expect(env.patches()).toHaveLength(1);
  } finally {
    await env.dispose();
  }
});

test('a 200 with a different saved value retains the editor until its input is confirmed', async () => {
  const env = await setup({
    override: (r, state) => (r.method === 'PATCH' ? success(state.card) : null),
  });
  try {
    await editDescription('not confirmed');
    await press('Save description');
    await screen.findByText(
      'The saved value was not confirmed. Your draft is retained.',
    );
    expect(screen.getByLabelText('Description').props.value).toBe(
      'not confirmed',
    );
    expect(env.patches()).toHaveLength(1);
  } finally {
    await env.dispose();
  }
});

test('real dates use the account zone and a Workspace-only reader never fetches restricted member profiles', async () => {
  const env = await setup({
    readOnly: true,
    override: (r) => {
      if (r.path.endsWith('/preferences')) return success({ timeZone: 'UTC' });
      if (r.path.endsWith('/members'))
        return response(
          page(
            [
              {
                user: {
                  id: USER_B,
                  displayName: 'Assigned colleague',
                  avatarUrl: null,
                },
              },
            ],
            1,
            100,
          ),
        );
      return null;
    },
  });
  try {
    await env.remote({
      assignees: [
        { userId: USER_B, assignedById: USER_A, createdAt: timestamp },
      ],
      startDate: timestamp,
      dueDate: timestamp,
    });
    expect(
      await screen.findByLabelText('Assignees: Assigned member'),
    ).toBeTruthy();
    expect(await screen.findAllByText('2026-11-13 · 09:00')).toHaveLength(2);
    expect(
      env.requests.filter(({ path }) => path.endsWith('/members')),
    ).toHaveLength(0);
    expect(screen.queryByLabelText('Assignees: Assigned colleague')).toBeNull();
    await env.board({ currentUserRole: 'MEMBER' });
    await screen.findByLabelText('Assignees: Assigned colleague');
    expect(
      screen.queryByRole('button', { name: 'Manage assignees' }),
    ).toBeNull();
  } finally {
    await env.dispose();
  }
});

test('real MOB-06 socket hints refetch the field and Board archive retains a hidden draft through reauthorization', async () => {
  let labels = [
    { id: uuid(7000), boardId, name: 'QA label', color: '#615CF7' },
  ];
  const env = await setup({
    liveSocket: true,
    override: (r) =>
      r.path === `/api${cardPath}/labels`
        ? success({ cardId: cardDto(1).id, labels })
        : null,
  });
  try {
    await screen.findByText('Card 1');
    await act(() =>
      env.realtime.setEnvironment({ foreground: true, online: true }),
    );
    await waitFor(() => expect(env.sockets.length).toBeGreaterThan(0));
    const socket = env.sockets.at(-1);
    await act(() => socket.server('connect'));
    await waitFor(() =>
      expect(socket.commands.some(({ event }) => event === 'board:join')).toBe(
        true,
      ),
    );
    await act(() =>
      socket.ack(
        socket.commands.findLastIndex(({ event }) => event === 'board:join'),
      ),
    );
    await editDescription('survives verification');
    expect(await screen.findByText('QA label')).toBeTruthy();
    labels = [{ ...labels[0], name: 'QA label renamed' }];
    await act(() => {
      socket.server('labels:changed', { boardId, labelId: labels[0].id });
      env.time.advance(50);
    });
    expect(await screen.findByText('QA label renamed')).toBeTruthy();
    expect(screen.getByLabelText('Description').props.value).toBe(
      'survives verification',
    );
    env.serverOnly({ description: 'Web-side description' });
    await act(() => {
      socket.server('card:updated', {
        boardId,
        cardId: cardDto(1).id,
        columnId: column(1).id,
        changeScope: 'card-fields',
      });
      env.time.advance(50);
    });
    await screen.findByRole('button', { name: 'Load latest' });
    expect(screen.getByLabelText('Description').props.value).toBe(
      'survives verification',
    );
    env.serverBoard({ isArchived: true, archivedAt: timestamp });
    const previousJoins = socket.commands.filter(
      ({ event }) => event === 'board:join',
    ).length;
    await act(() => {
      socket.server('board:archived', { boardId });
      env.time.advance(50);
    });
    await waitFor(() =>
      expect(
        socket.commands.filter(({ event }) => event === 'board:join').length,
      ).toBeGreaterThan(previousJoins),
    );
    await act(() =>
      socket.ack(
        socket.commands.findLastIndex(({ event }) => event === 'board:join'),
      ),
    );
    await screen.findByText('Archived board · Read-only');
    expect(screen.getByLabelText('Description').props.value).toBe(
      'survives verification',
    );
    expect(
      screen.getByRole('button', { name: 'Keep mine and save' }),
    ).toBeDisabled();
    expect(env.patches()).toHaveLength(0);
  } finally {
    await env.dispose();
  }
});

test('multiline editor exposes native scrolling, does not truncate long values, and stays cancelable offline', async () => {
  const env = await setup();
  try {
    await editDescription('long line '.repeat(190));
    expect(screen.getAllByText('Description')).toHaveLength(1);
    const input = screen.getByLabelText('Description');
    expect(input.props.multiline).toBe(true);
    expect(input.props.scrollEnabled).toBe(false);
    await act(() => onlineManager.setOnline(false));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save description' }),
      ).toBeDisabled(),
    );
    expect(screen.getByLabelText('Description').props.value).toHaveLength(1900);
    await press('Cancel');
  } finally {
    await env.dispose();
  }
});

test('assignees use paged eligible members, reconcile duplicate taps and unassign via 204', async () => {
  const members = Array.from({ length: 101 }, (_, i) => ({
    user: {
      id: i === 100 ? USER_B : uuid(6000 + i),
      displayName: i === 100 ? 'Page two colleague' : `Colleague ${i + 1}`,
      avatarUrl: null,
    },
  }));
  let assigned = [];
  const gate = deferred();
  const env = await setup({
    override: (r, state) => {
      if (r.path.endsWith('/members'))
        return response(page(members, r.page, 100));
      if (r.path.endsWith('/assignees') && r.method === 'POST')
        return gate.promise.then(() => {
          assigned = [
            {
              userId: r.body.userId,
              assignedById: USER_A,
              createdAt: timestamp,
            },
          ];
          return success(assigned[0], 201);
        });
      if (r.path.endsWith(`/assignees/${USER_B}`) && r.method === 'DELETE') {
        assigned = [];
        return {
          status: 204,
          ok: true,
          headers: { get: () => null },
          text: () => {
            throw new Error('204 cannot read JSON');
          },
        };
      }
      if (r.path === `/api${cardPath}` && r.method === 'GET')
        return success({ ...state.card, assignees: assigned });
      return null;
    },
  });
  try {
    await env.board({ currentUserRole: 'MEMBER' });
    await press('Manage assignees');
    await fireEvent.changeText(
      screen.getByLabelText('Search board members'),
      'page TWO',
    );
    expect(
      await screen.findByText(
        'Search covers loaded members. Load more for additional results.',
      ),
    ).toBeTruthy();
    await press('Load more members');
    const row = await screen.findByRole('checkbox', {
      name: 'Page two colleague',
    });
    await fireEvent.press(row);
    await fireEvent.press(row);
    expect(
      env.requests
        .filter((r) => r.method === 'POST' && r.path.endsWith('/assignees'))
        .map((r) => r.body),
    ).toEqual([{ userId: USER_B }]);
    await act(() => gate.resolve());
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'Page two colleague' }),
      ).toBeChecked(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'Page two colleague' }),
      ).toBeEnabled(),
    );
    await fireEvent.press(
      screen.getByRole('checkbox', { name: 'Page two colleague' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'Page two colleague' }),
      ).not.toBeChecked(),
    );
    expect(
      env.requests.some(
        (r) => r.method === 'DELETE' && r.path.endsWith(`/assignees/${USER_B}`),
      ),
    ).toBe(true);
  } finally {
    await env.dispose();
  }
});

test('Card labels read their own DTO, support a third catalog page, and reflect Board CRUD after confirmation', async () => {
  let labels = Array.from({ length: 251 }, (_, i) => ({
    id: uuid(10000 + i),
    boardId,
    name: `Label ${i + 1}`,
    color: '#615CF7',
  }));
  const last = labels.at(-1);
  const assigned = new Set([last.id]);
  const boardLabels = `/api/boards/${boardId}/labels`;
  const assignments = `/api${cardPath}/labels`;
  const empty = {
    status: 204,
    ok: true,
    headers: { get: () => null },
    text: () => {
      throw new Error('204 cannot read JSON');
    },
  };
  const dto = () => ({
    cardId: cardDto(1).id,
    labels: labels.filter(({ id }) => assigned.has(id)),
  });
  const env = await setup({
    override(r) {
      if (r.path === boardLabels && r.method === 'GET')
        return response(page(labels, r.page, 100));
      if (r.path === boardLabels && r.method === 'POST') {
        const saved = { id: uuid(11000), boardId, ...r.body };
        labels = [saved, ...labels];
        return success(saved, 201);
      }
      if (r.path === assignments) {
        if (r.method === 'POST') assigned.add(r.body.labelId);
        return success(dto(), r.method === 'POST' ? 201 : 200);
      }
      if (r.path.startsWith(assignments + '/') && r.method === 'DELETE') {
        assigned.delete(r.path.split('/').at(-1));
        return empty;
      }
      if (r.path.startsWith(boardLabels + '/')) {
        const id = r.path.split('/').at(-1);
        if (r.method === 'DELETE') {
          labels = labels.filter((item) => item.id !== id);
          assigned.delete(id);
          return empty;
        }
        if (r.method === 'PATCH') {
          const saved = { ...labels.find((item) => item.id === id), ...r.body };
          labels = labels.map((item) => (item.id === id ? saved : item));
          return success(saved);
        }
      }
      return null;
    },
  });
  try {
    expect(await screen.findByText(last.name)).toBeTruthy();
    expect(env.requests.some(({ path }) => path === boardLabels)).toBe(false);
    await press('Manage labels');
    await fireEvent.changeText(
      screen.getByLabelText('Search labels'),
      last.name,
    );
    const chip = await screen.findByRole('checkbox', {
      name: last.name,
    });
    expect(chip).toBeChecked();
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: last.name })).toBeEnabled(),
    );
    await fireEvent.press(chip);
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: last.name })).toBeNull(),
    );
    await press('Load more labels');
    await waitFor(() =>
      expect(
        env.requests.some(
          ({ path, page }) => path === boardLabels && page === 2,
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Load more labels' }),
      ).toBeEnabled(),
    );
    await press('Load more labels');
    const finalRow = await screen.findByRole('checkbox', { name: last.name });
    await waitFor(() => expect(finalRow).toBeEnabled());
    await fireEvent.press(finalRow);
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: last.name })).toBeChecked(),
    );
    await press('Manage board labels');
    await fireEvent.changeText(
      screen.getByLabelText('Search labels'),
      last.name,
    );
    await press(`Edit ${last.name}`);
    await fireEvent.changeText(
      screen.getByLabelText('Label name'),
      'Design review',
    );
    await press('Back to labels');
    expect(await screen.findByText('Discard label changes?')).toBeTruthy();
    await press('Keep editing');
    expect(screen.getByLabelText('Label name').props.value).toBe(
      'Design review',
    );
    await fireEvent.changeText(screen.getByLabelText('Color'), '#ff9900');
    await press('Save label');
    await screen.findByText('Board labels');
    expect(env.patches()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: { name: 'Design review', color: '#FF9900' },
        }),
      ]),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Search labels'),
      'design review',
    );
    await press('Edit Design review');
    await press('Delete label');
    expect(await screen.findByText(/removes it from every card/)).toBeTruthy();
    expect(
      env.requests.some(
        ({ path, method }) =>
          path === `${boardLabels}/${last.id}` && method === 'DELETE',
      ),
    ).toBe(false);
    await press('Delete label');
    await screen.findByText('Board labels');
    expect(assigned.has(last.id)).toBe(false);
    await press('Create label');
    await fireEvent.changeText(screen.getByLabelText('Label name'), 'Label 1');
    await press('Save label');
    expect(
      await screen.findByText('A board label already uses this name.'),
    ).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText('Label name'),
      '  Customer  ',
    );
    await press('Save label');
    await screen.findByText('Board labels');
    expect(env.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: boardLabels,
          method: 'POST',
          body: { name: 'Customer', color: '#615CF7' },
        }),
      ]),
    );
  } finally {
    await env.dispose();
  }
});

test('native date controls preserve a dirty description, PATCH one instant or null, and cancel/no-op without writes', async () => {
  const original = '2026-11-13T09:00:00.000Z';
  const env = await setup({
    override: (r) =>
      r.path.endsWith('/preferences')
        ? success({ timeZone: 'Asia/Kathmandu', dateFormat: 'DD/MM/YYYY' })
        : null,
  });
  const platform = jest.replaceProperty(Platform, 'OS', 'android');
  try {
    await env.remote({ startDate: original, dueDate: original });
    await editDescription('Unsent text');
    await press('Edit due date');
    await press('Save');
    expect(env.patches()).toHaveLength(0);
    await press('Edit due date');
    await press('Choose time');
    const picker = DateTimePickerAndroid.open.mock.calls.at(-1)[0];
    expect(picker).toMatchObject({ mode: 'time', timeZoneName: 'UTC' });
    await act(() =>
      picker.onValueChange({}, new Date('2026-11-13T23:00:00.000Z')),
    );
    await press('Dismiss date editor');
    expect(await screen.findByText('Discard date changes?')).toBeTruthy();
    await press('Keep editing');
    expect(screen.getByText('23:00')).toBeTruthy();
    await fireEvent.press(
      within(screen.getByTestId('card-date-actions')).getByRole('button', {
        name: 'Cancel',
      }),
    );
    expect(env.patches()).toHaveLength(0);
    await press('Edit due date');
    await press('Choose time');
    await act(() =>
      DateTimePickerAndroid.open.mock.calls
        .at(-1)[0]
        .onValueChange({}, new Date('2026-11-13T23:00:00.000Z')),
    );
    await press('Save');
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Save', exact: true }),
      ).toBeNull(),
    );
    expect(env.patches().map(({ body }) => body)).toEqual([
      { dueDate: '2026-11-13T17:15:00.000Z' },
    ]);
    expect(screen.getByLabelText('Description').props.value).toBe(
      'Unsent text',
    );
    await press('Edit start date');
    await press('Clear');
    await press('Save');
    await waitFor(() => expect(env.patches()).toHaveLength(2));
    expect(env.patches()[1].body).toEqual({ startDate: null });
  } finally {
    platform.restore();
    await env.dispose();
  }
});

test('an optional roster denial and a removed assignee never expose profiles or evict the Card', async () => {
  let denied = true;
  let members = [
    {
      user: { id: USER_B, displayName: 'Eligible colleague', avatarUrl: null },
    },
  ];
  const env = await setup({
    override(r) {
      if (r.path.endsWith('/members'))
        return denied
          ? fail(403, 'BOARD_MEMBERSHIP_REQUIRED')
          : response(page(members, 1, 100));
      if (r.path.endsWith('/assignees') && r.method === 'POST') {
        members = [];
        return fail(404, 'CARD_ASSIGNEE_NOT_FOUND');
      }
      return null;
    },
  });
  try {
    await env.board({ currentUserRole: 'MEMBER' });
    await press('Manage assignees');
    expect(
      await screen.findByText(
        /board’s members are unavailable|no longer have permission|Access changed/,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole('checkbox', { name: 'Eligible colleague' }),
    ).toBeNull();
    denied = false;
    await press('Done');
    await press('Manage assignees');
    await act(() =>
      env.data.invalidate(env.data.getIdentity(), [
        queryKeys.members(env.data.getIdentity(), boardId),
      ]),
    );
    const eligible = await screen.findByRole('checkbox', {
      name: 'Eligible colleague',
    });
    await fireEvent.press(eligible);
    expect(
      await screen.findByText(/This item is no longer available/),
    ).toBeTruthy();
    expect(
      screen.queryByRole('checkbox', { name: 'Eligible colleague' }),
    ).toBeNull();
    expect(screen.queryByText('Card unavailable')).toBeNull();
    await press('Done');
    expect(await screen.findByText('Card 1')).toBeTruthy();
  } finally {
    await env.dispose();
  }
});

test('date Save detects a changed account time zone and retains the unsubmitted wall time', async () => {
  let zone = 'America/New_York';
  const env = await setup({
    override: (r) =>
      r.path.endsWith('/preferences') ? success({ timeZone: zone }) : null,
  });
  const platform = jest.replaceProperty(Platform, 'OS', 'android');
  try {
    await env.remote({ dueDate: '2026-11-01T07:00:00.000Z' });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Edit due date' }),
      ).toBeEnabled(),
    );
    await press('Edit due date');
    await press('Choose time');
    await act(() =>
      DateTimePickerAndroid.open.mock.calls
        .at(-1)[0]
        .onValueChange({}, new Date('2026-11-01T01:30:00.000Z')),
    );
    expect(
      await screen.findByText('This time occurs twice. Choose its UTC offset.'),
    ).toBeTruthy();
    await press('UTC−05:00');
    zone = 'UTC';
    await press('Save');
    expect(
      await screen.findAllByText(/Your time zone changed/),
    ).not.toHaveLength(0);
    expect(screen.getByText('01:30')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(env.patches()).toHaveLength(0);
  } finally {
    platform.restore();
    await env.dispose();
  }
});

test('a date rate limit keeps Clear staged and only permits a manual retry after Retry-After', async () => {
  const original = '2026-11-13T09:00:00.000Z';
  let attempts = 0;
  const env = await setup({
    override: (r) =>
      r.path === `/api${cardPath}` && r.method === 'PATCH' && ++attempts === 1
        ? fail(429, 'TOO_MANY_REQUESTS', '1')
        : null,
  });
  try {
    await env.remote({ startDate: original, dueDate: original });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Edit due date' }),
      ).toBeEnabled(),
    );
    await press('Edit due date');
    await press('Clear');
    await press('Save');
    expect(
      await screen.findByText('Too many requests. Try again shortly.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(attempts).toBe(1);
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
      { timeout: 3000 },
    );
    expect(attempts).toBe(1);
    await press('Save');
    await waitFor(() =>
      expect(screen.queryByTestId('card-date-actions')).toBeNull(),
    );
    expect(env.patches().map(({ body }) => body)).toEqual([
      { dueDate: null },
      { dueDate: null },
    ]);
    expect(await screen.findByText('2026-11-13 · 09:00')).toBeTruthy();
  } finally {
    await env.dispose();
  }
});

test('MOB-22 uses the actual canonical Card stack and restores Table filters and sorting after Back', async () => {
  const env = await setup({ initialUrl: `/boards/${boardId}` });
  try {
    await fireEvent.press(await screen.findByRole('tab', { name: 'Table' }));
    await press('Sort: Board order');
    await fireEvent.changeText(screen.getByLabelText('Search cards'), 'Card');
    await press('Latest due date');
    await press('Apply filters (2)');
    await press('Open card: Card 1');
    await screen.findByText('Original\nsecond line');
    expect(screen).toHavePathname(cardPath);
    await act(() => router.back());
    await screen.findByTestId('board-table');
    await press('Sort: Latest due date');
    expect(screen.getByLabelText('Search cards').props.value).toBe('Card');
    await press('Cancel');
    expect(
      screen.getByRole('tab', { name: 'Table' }).props.accessibilityState
        .selected,
    ).toBe(true);
    expect(screen).toHavePathname(`/boards/${boardId}`);
    await fireEvent.press(screen.getByRole('tab', { name: 'Board' }));
    await screen.findByTestId('board-columns');
    expect(screen.getByRole('button', { name: 'Filters (2)' })).toBeTruthy();
  } finally {
    await env.dispose();
  }
});

test('MOB-22 real realtime owner coalesces hints, reconciles moved/archived rows and fences revoked Table content', async () => {
  const env = await setup({
    initialUrl: `/boards/${boardId}`,
    liveSocket: true,
    override: (request, current) =>
      request.path.endsWith('/cards')
        ? response(
            page(
              current.card.isArchived ? [] : [current.card],
              request.page,
              100,
            ),
          )
        : null,
  });
  try {
    await fireEvent.press(await screen.findByRole('tab', { name: 'Table' }));
    await screen.findByRole('button', { name: 'Open card: Card 1' });
    await act(() =>
      env.realtime.setEnvironment({ foreground: true, online: true }),
    );
    await waitFor(() => expect(env.sockets.length).toBeGreaterThan(0));
    const socket = env.sockets.at(-1);
    await act(() => socket.server('connect'));
    await waitFor(() =>
      expect(socket.commands.some(({ event }) => event === 'board:join')).toBe(
        true,
      ),
    );
    await act(() =>
      socket.ack(
        socket.commands.findLastIndex(({ event }) => event === 'board:join'),
      ),
    );
    await screen.findByText('Column: Column 1');
    const reads = () =>
      env.requests.filter(({ path }) => path.endsWith('/cards')).length;
    const boardReads = () =>
      env.requests.filter(({ path }) => path === `/api/boards/${boardId}`)
        .length;
    const before = reads();
    const beforeBoard = boardReads();
    env.serverOnly({
      title: 'Moved on another client',
      columnId: column(2).id,
    });
    await act(() => {
      for (let i = 0; i < 3; i++)
        socket.server('card:updated', {
          boardId,
          cardId: cardDto(1).id,
          columnId: column(2).id,
          changeScope: 'card-fields',
        });
      env.time.advance(50);
    });
    await screen.findByRole('button', {
      name: 'Open card: Moved on another client',
    });
    await screen.findByText('Column: Column 2');
    expect(reads()).toBe(before + 1);
    expect(boardReads()).toBe(beforeBoard);
    env.serverOnly({ isArchived: true, archivedAt: timestamp });
    await act(() => {
      socket.server('card:archived', {
        boardId,
        cardId: cardDto(1).id,
        columnId: column(2).id,
      });
      env.time.advance(50);
    });
    await screen.findByText('0 cards');
    expect(screen.queryByText('Moved on another client')).toBeNull();
    env.serverBoard({
      capabilities: { ...boardDetail.capabilities, canReadBoard: false },
    });
    await act(() => {
      socket.server('board:access-revoked', { boardId });
      env.time.advance(50);
    });
    await screen.findByText('Board unavailable');
    expect(screen.queryByTestId('board-table')).toBeNull();
  } finally {
    await env.dispose();
  }
});

const checklistCard = cardDto(1).id;
const checklistPath = `/api${cardPath}/checklists`;

test('MOB-20 loads and retries independently, and keeps a dirty MOB-18 description across remote checklist hints', async () => {
  const firstRead = deferred();
  let available = false;
  let rows = [];
  const env = await setup({
    liveSocket: true,
    override: ({ path }) => {
      if (path !== checklistPath) return null;
      return available
        ? success(checklists(checklistCard, rows))
        : firstRead.promise;
    },
  });
  try {
    await screen.findByLabelText('Loading checklists');
    await editDescription('Unsaved checklist-neighbor text');
    await act(() => firstRead.resolve(fail(500)));
    await screen.findByText('Couldn’t load checklists');
    expect(screen.getByText('Card 1')).toBeTruthy();
    available = true;
    await press('Retry checklists');
    await screen.findByText('No checklists');
    expect(
      screen.getByLabelText('Card checklist progress: 0 of 0 complete'),
    ).toBeTruthy();
    await act(() =>
      env.realtime.setEnvironment({ foreground: true, online: true }),
    );
    await waitFor(() => expect(env.sockets.length).toBeGreaterThan(0));
    const socket = env.sockets.at(-1);
    await act(() => socket.server('connect'));
    await waitFor(() =>
      expect(socket.commands.some(({ event }) => event === 'board:join')).toBe(
        true,
      ),
    );
    await act(async () => {
      socket.ack(
        socket.commands.findLastIndex(({ event }) => event === 'board:join'),
      );
      await Promise.resolve();
    });
    const boardReads = env.requests.filter(
      ({ path }) => path === `/api/boards/${boardId}`,
    ).length;
    rows = [
      checklist(checklistCard, 1, [true, false]),
      checklist(checklistCard, 2, [true]),
    ];
    await act(async () => {
      socket.server('card:updated', {
        boardId,
        cardId: checklistCard,
        columnId: column(1).id,
        changeScope: 'checklists',
      });
      env.time.advance(60);
    });
    await screen.findByLabelText('Card checklist progress: 2 of 3 complete');
    expect(screen.getByLabelText('Description').props.value).toBe(
      'Unsaved checklist-neighbor text',
    );
    expect(
      env.requests.filter(({ path }) => path === `/api/boards/${boardId}`),
    ).toHaveLength(boardReads);
  } finally {
    firstRead.resolve(fail(500));
    await env.dispose();
  }
});

test('MOB-20 creates and renames lists/items, moves within their own order, and deletes only after confirmation', async () => {
  let rows = [checklist(checklistCard, 1, [true, false])];
  const changed = deferred();
  let nextNumber = 2;
  const env = await setup({
    override: ({ path, method, body }) => {
      if (!path.startsWith(checklistPath)) return null;
      if (method === 'GET') return success(checklists(checklistCard, rows));
      if (method === 'POST' && path === checklistPath) {
        const created = checklist(checklistCard, nextNumber++, [], body.title);
        rows.push(created);
        return success(created, 201);
      }
      const [, listId, , itemId] = path.slice(checklistPath.length).split('/');
      const list = rows.find((row) => row.id === listId);
      if (method === 'POST') {
        list.items.push({
          ...checklist(checklistCard, nextNumber++, [false]).items[0],
          checklistId: list.id,
          text: body.text,
        });
      } else if (method === 'DELETE') {
        if (itemId) {
          list.items = list.items.filter((item) => item.id !== itemId);
          Object.assign(list, itemCounts(list.items));
          return response(undefined, 204);
        }
        rows = rows.filter((row) => row !== list);
        return changed.promise.then(() => response(undefined, 204));
      } else if (path.endsWith('/move')) {
        const entries = itemId ? list.items : rows;
        const source = entries.find(({ id }) => id === (itemId ?? listId));
        entries.splice(entries.indexOf(source), 1);
        const before = itemId ? body.beforeItemId : body.beforeChecklistId;
        entries.splice(
          before === null
            ? entries.length
            : entries.findIndex(({ id }) => id === before),
          0,
          source,
        );
      } else if (itemId) {
        Object.assign(
          list.items.find(({ id }) => id === itemId),
          body,
        );
      } else {
        Object.assign(list, body);
      }
      Object.assign(list, itemCounts(list.items));
      return success(list, method === 'POST' ? 201 : 200);
    },
  });
  try {
    await press('Add checklist');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await fireEvent.changeText(
      screen.getByLabelText('Checklist title'),
      '  Release ',
    );
    await press('Save');
    await screen.findByText('Release');
    await press('Actions for checklist Release');
    await press('Move to top');
    await waitFor(() =>
      expect(screen.queryByText('Checklist actions')).toBeNull(),
    );
    expect(env.patches().at(-1).body).toEqual({
      beforeChecklistId: rows[1].id,
    });
    await press('Actions for checklist Release');
    await press('Rename checklist');
    await fireEvent.changeText(
      screen.getByLabelText('Checklist title'),
      'Ship',
    );
    await press('Save');
    await screen.findByText('Ship');
    await press('Add item to Ship');
    await fireEvent.changeText(
      screen.getByLabelText('Item text'),
      'New release task',
    );
    await press('Save');
    await screen.findByRole('checkbox', {
      name: 'New release task',
      checked: false,
    });
    await press('Actions for item New release task');
    await press('Edit item');
    await fireEvent.changeText(
      screen.getByLabelText('Item text'),
      'Edited release task',
    );
    await press('Save');
    await screen.findByRole('checkbox', { name: 'Edited release task' });
    await press('Actions for item Item 1.1');
    await press('Move to bottom');
    await waitFor(() => expect(screen.queryByText('Item actions')).toBeNull());
    expect(env.patches().at(-1).body).toEqual({ beforeItemId: null });
    await press('Actions for item Item 1.1');
    await press('Delete item');
    await press('Cancel');
    expect(
      screen.getByRole('checkbox', { name: 'Item 1.1', checked: true }),
    ).toBeTruthy();
    await press('Actions for item Item 1.1');
    await press('Delete item');
    await press('Delete item');
    await screen.findByLabelText('Card checklist progress: 0 of 2 complete');
    await press('Actions for checklist Ship');
    await press('Delete checklist');
    expect(
      screen.getByText(
        'This permanently deletes the checklist and all its items.',
      ),
    ).toBeTruthy();
    await press('Delete checklist');
    expect(
      screen.getByRole('button', { name: 'Delete checklist' }),
    ).toBeDisabled();
    expect(
      env.requests.filter(({ method }) => method === 'DELETE'),
    ).toHaveLength(2);
    const identity = env.data.getIdentity();
    // The server can publish after commit, before sending its DELETE 204.
    await act(() =>
      env.data.invalidate(identity, [
        queryKeys.checklists(identity, boardId, checklistCard),
      ]),
    );
    expect(
      screen.getByRole('checkbox', {
        name: 'Edited release task',
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    await act(() => changed.resolve());
    await screen.findByLabelText('List 1: 0 of 1 complete');
    expect(
      screen.queryByRole('checkbox', { name: 'Edited release task' }),
    ).toBeNull();
  } finally {
    changed.resolve();
    await env.dispose();
  }
});

test('MOB-20 checkbox rapidly changes intent and a held response does not reverse it', async () => {
  let list = checklist(checklistCard, 1, [false]);
  const held = deferred();
  let writes = 0;
  const env = await setup({
    override: ({ path, method, body }) => {
      if (!path.startsWith(checklistPath)) return null;
      if (method === 'GET') return success(checklists(checklistCard, [list]));
      const items = list.items.map((item) => ({
        ...item,
        isChecked: body.isChecked,
      }));
      list = { ...list, items, ...itemCounts(items) };
      writes++;
      return writes === 1 ? held.promise : success(list);
    },
  });
  try {
    const checkbox = () => screen.getByRole('checkbox', { name: 'Item 1.1' });
    await screen.findByRole('checkbox', { name: 'Item 1.1', checked: false });
    await fireEvent.press(checkbox());
    expect(checkbox().props.accessibilityState.checked).toBe(true);
    await fireEvent.press(checkbox());
    expect(checkbox().props.accessibilityState.checked).toBe(false);
    expect(writes).toBe(1);
    await act(() => held.resolve(success(list)));
    await waitFor(() =>
      expect(env.patches().map(({ body }) => body)).toEqual([
        { isChecked: true },
        { isChecked: false },
      ]),
    );
    await waitFor(() => expect(checkbox()).not.toBeDisabled());
    expect(checkbox().props.accessibilityState.checked).toBe(false);
    expect(screen.getByLabelText('List 1: 0 of 1 complete')).toBeTruthy();
    await act(() => onlineManager.setOnline(false));
    await screen.findByText(
      'You’re offline. Showing the last loaded checklists.',
    );
    expect(checkbox()).toBeDisabled();
    await fireEvent.press(checkbox());
    expect(env.patches()).toHaveLength(2);
  } finally {
    held.resolve(fail(500));
    await env.dispose();
  }
});

test('MOB-20 ambiguous POST keeps the draft, reconciles a committed addition and requires explicit review', async () => {
  let rows = [];
  const dispatched = deferred();
  const env = await setup({
    override: ({ path, method, body }) => {
      if (path !== checklistPath) return null;
      if (method === 'POST') {
        rows = [checklist(checklistCard, 1, [], body.title)];
        return dispatched.promise.then(() => {
          throw new Error('connection dropped');
        });
      }
      return success(checklists(checklistCard, rows));
    },
  });
  try {
    await press('Add checklist');
    await fireEvent.changeText(
      screen.getByLabelText('Checklist title'),
      'Maybe committed',
    );
    const saveButton = screen.getByRole('button', { name: 'Save' });
    await fireEvent.press(saveButton);
    await fireEvent.press(saveButton);
    await act(() => dispatched.resolve());
    await screen.findByText(/Couldn’t confirm the addition/);
    expect(screen.getByDisplayValue('Maybe committed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await press('Cancel');
    await press('Discard changes');
    expect(
      screen.getByRole('button', { name: 'Add checklist' }),
    ).toBeDisabled();
    await press('Reload checklists');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Add checklist' }),
      ).not.toBeDisabled(),
    );
    expect(
      screen.getByRole('header', { name: 'Maybe committed' }),
    ).toBeTruthy();
    expect(
      env.requests.filter(
        ({ method, path }) => method === 'POST' && path === checklistPath,
      ),
    ).toHaveLength(1);
  } finally {
    dispatched.resolve(fail(500));
    await env.dispose();
  }
});
