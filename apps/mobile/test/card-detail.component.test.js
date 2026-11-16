/* global jest, test, expect, console */
import React from 'react';
import { URL } from 'node:url';
import { Dimensions, Text } from 'react-native';
import { Stack, Tabs, router, useRouter } from 'expo-router';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
  waitFor,
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
import { Button, ThemeContext } from '../src/ui';
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
    await env.remote({ title });
    const titleNode = await screen.findByText(title);
    expect(titleNode.props.numberOfLines).toBeUndefined();
    expect(
      screen.getByTestId('card-detail-metadata-grid').props.style.flexDirection,
    ).toBe('column');
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
