/* global jest, test, expect */
import { URL } from 'node:url';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';
import {
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
} from 'react-native';
import { CardComments } from '../src/features/cards/comments/CardComments';
import { MentionComposer } from '../src/features/cards/comments/MentionComposer';
import { CardCommentsSection } from '../src/features/cards/detail/sections';
import { createHttpClient } from '../src/infrastructure/api/client';
import { SessionProvider } from '../src/infrastructure/auth/SessionProvider';
import { createSessionManager } from '../src/infrastructure/auth/session-manager';
import { createCredentialStore } from '../src/infrastructure/auth/credential-store';
import { createMobileDataLayer } from '../src/infrastructure/query/data-layer';
import { DataProvider } from '../src/infrastructure/query/DataProvider';
import { queryKeys } from '../src/infrastructure/query/keys';
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
import { actor, member, membershipBoard } from './board-members/fixtures';
import { cardDto } from './workspaces/kanban-fixtures';
import { page, uuid } from './workspaces/fixtures';

const boardId = USER_A,
  cardId = USER_B;
const mockRouter = { push: jest.fn() };
const mockPrevent = jest.fn(() => jest.fn());
jest.setTimeout(30000);
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  usePreventRemove: (...args) => mockPrevent(...args),
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
        <native.View testID="native-modal">{children}</native.View>
      ) : null,
  };
  descriptors.useWindowDimensions = {
    configurable: true,
    enumerable: true,
    value: () => ({ width: 320, height: 568, scale: 2, fontScale: 1.6 }),
  };
  descriptors.useColorScheme = {
    configurable: true,
    enumerable: true,
    value: jest.fn(() => 'light'),
  };
  return Object.create(Object.getPrototypeOf(native), descriptors);
});
const row = (n = 1, own = true) => ({
  id: uuid(100 + n),
  cardId,
  authorId: own ? USER_A : member().user.id,
  content: `Comment ${n}\n😀 <script>safe text</script> https://example.test`,
  mentions: [],
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
});
const response = (body, status = 200, retryAfter) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {
    get: (key) =>
      key === 'content-type' && status !== 204
        ? 'application/json'
        : key === 'retry-after'
          ? (retryAfter ?? null)
          : null,
  },
  text: async () => (status === 204 ? '' : JSON.stringify(body)),
});
const success = (data, status = 200) =>
  response({ success: true, statusCode: status, message: 'OK', data }, status);
const failure = (status, retryAfter) =>
  response(
    {
      success: false,
      statusCode: status,
      code: 'COMMENT_ERROR',
      message: 'Comment request failed.',
    },
    status,
    retryAfter,
  );
async function setup({
  rows = [row(), row(2, false)],
  members = [actor, member()],
  override,
  theme = 'light',
  board = membershipBoard(),
  archived = false,
  canEdit = true,
  component = CardCommentsSection,
} = {}) {
  useColorScheme.mockReturnValue('light');
  onlineManager.setOnline(true);
  mockPrevent.mockClear();
  const time = new FakeTime(),
    auth = new FakeSessionApi();
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
  const state = { rows, members, board, context: null };
  const calls = [];
  const fetch = async (input, init) => {
    const url = new URL(input);
    const call = {
      path: url.pathname,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body) : undefined,
      page: Number(url.searchParams.get('page')),
      limit: Number(url.searchParams.get('limit')),
    };
    calls.push(call);
    const custom = await override?.(call, state);
    if (custom) return custom;
    if (call.path.endsWith('/members'))
      return response(page(state.members, call.page, call.limit));
    if (call.path.includes('/comments')) {
      if (call.method === 'GET')
        return response(page(state.rows, call.page, call.limit));
      if (call.method === 'POST') {
        const saved = { ...row(99), ...call.body };
        state.rows = [...state.rows, saved];
        return success(saved, 201);
      }
      if (call.method === 'PATCH') {
        const saved = {
          ...state.rows.find((item) => item.id === call.path.split('/').at(-1)),
          ...call.body,
          updatedAt: '2026-11-20T00:01:00.000Z',
        };
        state.rows = state.rows.map((item) =>
          item.id === saved.id ? saved : item,
        );
        return success(saved);
      }
      if (call.method === 'DELETE') {
        state.rows = state.rows.filter(
          (item) => item.id !== call.path.split('/').at(-1),
        );
        return response(null, 204);
      }
    }
    if (call.path === `/api/boards/${boardId}`) return success(state.board);
    if (call.path === `/api/boards/${boardId}/cards/${cardId}`)
      return success(state.context.card);
    return failure(404);
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
  const identity = data.getIdentity();
  const card = { ...cardDto(1), id: cardId, boardId, isArchived: archived };
  state.context = {
    boardId,
    cardId,
    identity,
    board,
    card,
    canEdit,
    readOnly: !canEdit,
    active: true,
    refreshCard: async () => {},
  };
  data.queryClient.setQueryData(queryKeys.board(identity, boardId), board);
  data.queryClient.setQueryData(
    queryKeys.card(identity, boardId, cardId),
    card,
  );
  data.resources.confirmBoard(boardId, canEdit);
  const Component = component;
  const tree = () => (
    <SessionProvider manager={manager}>
      <DataProvider layer={data}>
        <ThemeContext.Provider value={theme}>
          <KeyboardAvoidingView
            testID="comments-keyboard-harness"
            behavior="height"
            style={{ flex: 1 }}
          >
            <ScrollView
              testID="comments-scroll-harness"
              keyboardShouldPersistTaps="handled"
            >
              <Text>Other Card section</Text>
              <Component
                key={`${state.context.identity.userId}:${state.context.identity.generation}`}
                context={state.context}
              />
            </ScrollView>
          </KeyboardAvoidingView>
        </ThemeContext.Provider>
      </DataProvider>
    </SessionProvider>
  );
  const mounted = await render(tree());
  return {
    data,
    manager,
    calls,
    state,
    mounted,
    writes: () => calls.filter((call) => call.method !== 'GET'),
    rerender: () => mounted.rerender(tree()),
    async dispose() {
      await mounted.unmount();
      data.dispose();
      manager.dispose();
      onlineManager.setOnline(true);
    },
  };
}
const press = async (name) =>
  fireEvent.press(await screen.findByRole('button', { name }));
const ready = () => screen.findByText('Current owner', {}, { timeout: 5000 });
const type = async (text, label = 'New comment') => {
  const input = await screen.findByLabelText(label);
  await fireEvent.changeText(input, text);
  await fireEvent(input, 'selectionChange', {
    nativeEvent: { selection: { start: text.length, end: text.length } },
  });
};

test('native key events select the intended duplicate-name member and retain UTF-16 cursor offsets', async () => {
  const changed = jest.fn();
  const candidates = [USER_A, USER_B].map((userId) => ({
    userId,
    displayName: 'Same',
    page: 1,
  }));
  const view = await render(
    <MentionComposer
      label="Keyboard comment"
      draft={{ text: '😀 @', spans: [] }}
      onChange={changed}
      candidates={candidates}
      disabled={false}
      membersLoading={false}
      moreMembers={false}
      loadMembers={() => {}}
    />,
  );
  try {
    const field = screen.getByLabelText('Keyboard comment');
    const key = async (value) =>
      fireEvent(field, 'keyPress', {
        nativeEvent: { key: value },
        preventDefault: jest.fn(),
      });
    await key('ArrowDown');
    await key('ArrowUp');
    await key('ArrowDown');
    await key('Tab');
    expect(changed).toHaveBeenLastCalledWith({
      text: '😀 @Same ',
      spans: [{ userId: USER_B, start: 3, end: 8 }],
    });
  } finally {
    await view.unmount();
  }
});

test('MOB-18 slot displays plain text, real attribution, edited/deleted fallbacks and paginates 101 comments with at most 20 rows', async () => {
  const rows = Array.from({ length: 101 }, (_, i) => row(i + 1, i === 0));
  rows[1].author = { isDeleted: true, displayName: 'Deleted user' };
  rows[2].authorId = uuid(999);
  rows[0].updatedAt = '2026-11-20T00:02:00.000Z';
  const env = await setup({ rows });
  try {
    await ready();
    expect(screen.getByText(rows[0].content)).toBeTruthy();
    expect(screen.getByText('101 comments')).toBeTruthy();
    expect(screen.getByText('Deleted user')).toBeTruthy();
    expect(screen.getByText('Unknown author')).toBeTruthy();
    expect(screen.getByText(/Edited/)).toBeTruthy();
    expect(screen.getAllByTestId(/^comment-/)).toHaveLength(20);
    expect(
      screen.getAllByRole('button', { name: /^Edit comment by/ }),
    ).toHaveLength(1);
    await press('Next comments');
    await screen.findByText(rows[20].content);
    expect(screen.queryByText(rows[0].content)).toBeNull();
    expect(screen.getAllByTestId(/^comment-/)).toHaveLength(20);
    await press('Previous comments');
    await ready();
  } finally {
    await env.dispose();
  }
});

test('confirmed 201 clears draft, own edit prefills/saves, and delete requires destructive confirmation and accepts 204', async () => {
  const env = await setup();
  try {
    await ready();
    await type('  New 😀\ncomment  ');
    await press('Send comment');
    await screen.findByText('Comment posted.');
    expect(screen.getByLabelText('New comment').props.value).toBe('');
    expect(env.writes()[0].body).toEqual({
      content: 'New 😀\ncomment',
      mentions: [],
    });
    await fireEvent.press(
      screen.getAllByRole('button', {
        name: 'Edit comment by Current owner',
      })[0],
    );
    expect(screen.getByLabelText('Edit comment').props.value).toBe(
      row().content,
    );
    await type('Changed text', 'Edit comment');
    await press('Save comment');
    await screen.findByText('Comment saved.');
    await waitFor(() => expect(screen.getByText('Changed text')).toBeTruthy());
    await fireEvent.press(
      screen.getAllByRole('button', {
        name: 'Delete comment by Current owner',
      })[0],
    );
    expect(
      env.writes().filter((call) => call.method === 'DELETE'),
    ).toHaveLength(0);
    await press('Delete comment');
    await screen.findByText('Comment deleted.');
    expect(env.writes().map((call) => call.method)).toEqual([
      'POST',
      'PATCH',
      'DELETE',
    ]);
  } finally {
    await env.dispose();
  }
});

test('duplicate names use chosen ID, exact UTF-16 spans and manual roster pagination beyond 100 members', async () => {
  const members = Array.from({ length: 101 }, (_, i) => member(i + 1));
  members[100].user.displayName = 'Member 1';
  const env = await setup({ members, rows: [] });
  try {
    await screen.findByText('No comments yet.');
    await type('😀\n@');
    for (let p = 2; p <= 6; p++) {
      await press('Load more Board members');
      await waitFor(() =>
        expect(
          env.calls.some(
            (call) => call.path.endsWith('/members') && call.page === p,
          ),
        ).toBe(true),
      );
      await waitFor(() =>
        expect(screen.queryByText('Loading Board members…')).toBeNull(),
      );
    }
    await type('😀\n@Member 1');
    // Ten prefix matches precede member 101; the option window is bounded to eight.
    while (
      !screen.queryByRole('button', {
        name: `Mention Member 1, member ${members[100].user.id}`,
      })
    )
      await press('More matches');
    await press(`Mention Member 1, member ${members[100].user.id}`);
    await press('Send comment');
    await screen.findByText('Comment posted.');
    expect(env.writes()[0].body).toEqual({
      content: '😀\n@Member 1',
      mentions: [{ userId: members[100].user.id, start: 3, end: 12 }],
    });
    expect(
      env.calls.filter((call) => call.path.endsWith('/members')),
    ).toHaveLength(7);
    expect(
      env.calls.every(
        (call) =>
          !call.path.includes('/workspaces/') && !call.path.includes('/search'),
      ),
    ).toBe(true);
  } finally {
    await env.dispose();
  }
});

test.each(['readonly', 'archived-card', 'archived-board', 'outsider'])(
  '%s has no mutation controls or unauthorized roster request',
  async (mode) => {
    const board = membershipBoard(
      mode === 'readonly' || mode === 'outsider'
        ? {
            currentUserRole: null,
            capabilities: { canReadBoard: true, canWriteBoard: false },
          }
        : { isArchived: mode === 'archived-board' },
    );
    const env = await setup({
      board,
      archived: mode === 'archived-card',
      canEdit: false,
    });
    try {
      await screen.findByText('Comments are read-only.');
      expect(screen.queryByRole('button', { name: 'Send comment' })).toBeNull();
      expect(
        screen.queryByRole('button', { name: /^Edit comment by/ }),
      ).toBeNull();
      expect(screen.queryByLabelText('New comment')).toBeNull();
      if (mode === 'readonly' || mode === 'outsider')
        expect(env.calls.some((call) => call.path.endsWith('/members'))).toBe(
          false,
        );
    } finally {
      await env.dispose();
    }
  },
);

test('POST rapid taps lock, ambiguous committed send preserves draft and requires review plus explicit new-send acknowledgement', async () => {
  const gate = deferred();
  const env = await setup({
    override: (call, state) => {
      if (call.method === 'POST') {
        state.rows.push({ ...row(99), ...call.body });
        return gate.promise;
      }
    },
  });
  try {
    await ready();
    await type('Uncertain message');
    const send = screen.getByRole('button', { name: 'Send comment' });
    await fireEvent.press(send);
    await fireEvent.press(send);
    await waitFor(() => expect(env.writes()).toHaveLength(1));
    await act(async () => gate.resolve(failure(503)));
    await screen.findByText(/send result is uncertain/);
    expect(screen.getByLabelText('New comment').props.value).toBe(
      'Uncertain message',
    );
    expect(screen.getByRole('button', { name: 'Send comment' })).toBeDisabled();
    await press('Review latest comments');
    await press('Allow a new send');
    expect(screen.getByText(/earlier send may have succeeded/)).toBeTruthy();
    await press('Cancel');
    expect(env.writes()).toHaveLength(1);
  } finally {
    await env.dispose();
  }
});

test('remote edit conflicts retain draft and require review; cancel leaves composer text intact', async () => {
  const env = await setup();
  try {
    await ready();
    await type('Unsent composer');
    await press('Edit comment by Current owner');
    await type('My edit', 'Edit comment');
    env.state.rows[0] = {
      ...row(),
      content: 'Saved elsewhere',
      updatedAt: '2026-11-20T00:02:00.000Z',
    };
    await press('Save comment');
    await screen.findByText(/saved comment may have changed/);
    expect(screen.getByLabelText('Edit comment').props.value).toBe('My edit');
    expect(env.writes()).toHaveLength(0);
    await press('Review latest comments');
    await screen.findByText(/Latest saved version: Saved elsewhere/);
    expect(screen.getByLabelText('Edit comment').props.value).toBe('My edit');
    await press('Cancel editing');
    expect(screen.getByLabelText('New comment').props.value).toBe(
      'Unsent composer',
    );
  } finally {
    await env.dispose();
  }
});

test('roster denial clears protected comments/suggestions and stops writes without breaking other sections', async () => {
  let denied = false;
  const env = await setup({
    override: (call) =>
      denied && call.path.endsWith('/members') ? failure(403) : undefined,
  });
  try {
    await ready();
    await type('@');
    await screen.findByRole('button', {
      name: `Mention Member 1, member ${member().user.id}`,
    });
    denied = true;
    const deniedEvents = [];
    const stopDenied = env.data.resources.subscribeDenied((id, key) =>
      deniedEvents.push({ id, key }),
    );
    await act(async () => {
      await env.data.queryClient.invalidateQueries({
        queryKey: queryKeys.members(env.data.getIdentity(), boardId),
      });
    });
    stopDenied();
    expect(deniedEvents).toHaveLength(1);
    await screen.findByText(
      'Board membership must be checked before changing comments.',
    );
    expect(screen.queryByRole('button', { name: /^Mention / })).toBeNull();
    expect(screen.queryByText(row().content)).toBeNull();
    expect(screen.getByText('Other Card section')).toBeTruthy();
    expect(screen.getByLabelText('New comment').props.value).toBe('@');
    expect(screen.getByLabelText('New comment').props.editable).toBe(true);
    await type('@ordinary text');
    expect(screen.getByLabelText('New comment').props.value).toBe(
      '@ordinary text',
    );
    await type('@');
    expect(env.writes()).toHaveLength(0);
    denied = false;
    await press('Recheck Board membership');
    await screen.findByRole('button', {
      name: `Mention Member 1, member ${member().user.id}`,
    });
    await press('Retry comments');
    await ready();
  } finally {
    await env.dispose();
  }
});

test('offline and 429 retain drafts; list errors stay local and retry waits for Retry-After', async () => {
  const env = await setup({
    override: (call) =>
      call.path.includes('/comments') && call.method === 'GET'
        ? failure(429, '1')
        : undefined,
  });
  try {
    await screen.findByText('Too many requests. Try again shortly.');
    expect(
      screen.getByRole('button', { name: 'Retry comments' }),
    ).toBeDisabled();
    await type('Keep my draft');
    await act(async () => onlineManager.setOnline(false));
    expect(screen.getByRole('button', { name: 'Send comment' })).toBeDisabled();
    expect(screen.getByLabelText('New comment').props.value).toBe(
      'Keep my draft',
    );
    expect(screen.getByText('Other Card section')).toBeTruthy();
    expect(env.writes()).toHaveLength(0);
  } finally {
    await env.dispose();
  }
});

test('320dp, 160% fonts, dark/system tokens, multiline/scroll props and accessible navigation draft prompt', async () => {
  const env = await setup({ theme: 'system' });
  try {
    await ready();
    await type('Unsent comment');
    const [blocked, callback] = mockPrevent.mock.calls.at(-1);
    expect(blocked).toBe(true);
    await act(async () => callback({ repeat: jest.fn() }));
    await screen.findByText('Discard changes?');
    await press('Keep editing');
    expect(screen.getByLabelText('New comment').props.value).toBe(
      'Unsent comment',
    );
    const input = screen.getByLabelText('New comment');
    expect(input.props.multiline).toBe(true);
    await fireEvent(input, 'contentSizeChange', {
      nativeEvent: { contentSize: { height: 500, width: 260 } },
    });
    expect(screen.getByLabelText('New comment').props.scrollEnabled).toBe(true);
    expect(
      StyleSheet.flatten(screen.getByLabelText('New comment').props.style)
        .maxHeight,
    ).toBe(200);
    await act(async () => {
      useColorScheme.mockReturnValue('dark');
      await env.rerender();
    });
    const heading = screen.getByText('Comments');
    expect(StyleSheet.flatten(heading.props.style).color).toBe(
      palettes.dark.text,
    );
    expect(screen.getByLabelText('New comment').props.value).toBe(
      'Unsent comment',
    );
    expect(screen.getByTestId('comments-keyboard-harness')).toBeTruthy();
    expect(
      screen.getByTestId('comments-scroll-harness').props
        .keyboardShouldPersistTaps,
    ).toBe('handled');
    for (const node of screen.getAllByText(
      /Comments|Current owner|Other Card section/,
    ))
      expect(node.props.allowFontScaling).not.toBe(false);
    expect(screen.getByLabelText('New comment').props.accessibilityLabel).toBe(
      'New comment',
    );
  } finally {
    await env.dispose();
  }
});

test('session switch remounts scoped section and clears old comments, suggestions and drafts', async () => {
  const env = await setup({ component: CardComments });
  try {
    await ready();
    await type('Private unsent text');
    const oldKey = queryKeys.comments(env.data.getIdentity(), boardId, cardId);
    await act(async () => {
      await env.manager.establishSession(loginResponse(USER_B));
      env.state.context = {
        ...env.state.context,
        identity: env.data.getIdentity(),
        canEdit: false,
        board: { ...env.state.board, currentUserRole: null },
      };
      await env.rerender();
    });
    expect(screen.queryByDisplayValue('Private unsent text')).toBeNull();
    expect(
      env.data.queryClient.getQueryData([...oldKey, { page: 1, limit: 20 }]),
    ).toBeUndefined();
    expect(screen.queryByRole('button', { name: /^Mention / })).toBeNull();
  } finally {
    await env.dispose();
  }
});

test('a fresh nonmember Card context evicts an earlier roster, clears drafts and reloads the permitted plain-text projection', async () => {
  const env = await setup();
  try {
    await ready();
    await type('Private draft @');
    const identity = env.data.getIdentity();
    const before = env.calls.filter((call) =>
      call.path.endsWith('/members'),
    ).length;
    await act(async () => {
      env.state.context = {
        ...env.state.context,
        canEdit: false,
        readOnly: true,
        board: {
          ...env.state.board,
          currentUserRole: null,
          capabilities: { canReadBoard: true, canWriteBoard: false },
        },
      };
      await env.rerender();
    });
    await screen.findByText('Comments are read-only.');
    await screen.findByText(row().content);
    expect(screen.queryByDisplayValue('Private draft @')).toBeNull();
    expect(screen.queryByText('Current owner')).toBeNull();
    expect(
      env.data.queryClient
        .getQueriesData({ queryKey: queryKeys.members(identity, boardId) })
        .every(([, value]) => value === undefined),
    ).toBe(true);
    expect(
      env.calls.filter((call) => call.path.endsWith('/members')),
    ).toHaveLength(before);
  } finally {
    await env.dispose();
  }
});
