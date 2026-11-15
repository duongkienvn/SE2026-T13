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
import SettingsRoute from '../src/app/(private)/boards/[boardId]/settings';
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
  deferred,
  loginResponse,
  user,
} from './auth/support';
import {
  board as boardRow,
  page,
  uuid,
  workspace,
} from './workspaces/fixtures';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockRouter = { push: mockPush, replace: mockReplace };
let mockFocus = true;
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useIsFocused: () => mockFocus,
  useLocalSearchParams: () => ({
    boardId: '00000000-0000-4000-8000-0000000003e9',
  }),
  usePathname: () => '/boards/00000000-0000-4000-8000-0000000003e9/settings',
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
        <native.View testID="native-modal" onTouchEnd={onRequestClose}>
          {children}
        </native.View>
      ) : null,
  };
  return Object.create(Object.getPrototypeOf(native), descriptors);
});

const boardId = uuid(1001);
const source = { ...workspace(1, 'PERSONAL'), canCreateBoards: true };
const team = { ...workspace(2), name: 'Design team', canCreateBoards: true };
const locked = { ...workspace(3), name: 'Locked team', canCreateBoards: false };
const version1 = 'a'.repeat(64);
const version2 = 'b'.repeat(64);
const capabilities = (owner, archived = false) => ({
  canReadBoard: true,
  canWriteBoard: owner && !archived,
  canManageBoard: owner,
  canManageMembers: owner,
  canRestoreBoard: owner && archived,
});
function makeBoard(overrides = {}) {
  const role = overrides.currentUserRole ?? 'OWNER';
  const archived = overrides.isArchived ?? false;
  return {
    ...boardRow(source.id),
    name: 'Launch plan',
    createdById: USER_A,
    visibility: 'PRIVATE',
    currentUserRole: role,
    isStarterBoard: false,
    capabilities: capabilities(role === 'OWNER', archived),
    ...(archived ? { archivedAt: '2026-11-15T09:00:00.000Z' } : {}),
    ...overrides,
  };
}

function response(data, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (header) =>
        header === 'content-type' && status !== 204 ? 'application/json' : null,
    },
    text: async () => (status === 204 ? '' : JSON.stringify(data)),
  };
}
const result = (data, status = 200) =>
  response({ success: true, statusCode: status, message: 'OK', data }, status);
const failure = (status, code = 'FAILED', message = 'Request failed') =>
  response({ success: false, statusCode: status, code, message }, status);

async function setup({
  board = makeBoard(),
  policy = { canChangeVisibility: true },
  workspaces = [source, team, locked],
  override,
} = {}) {
  mockFocus = true;
  mockPush.mockClear();
  mockReplace.mockClear();
  onlineManager.setOnline(true);
  const state = { board };
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
  const requests = [];
  const fetch = async (input, options) => {
    const url = new URL(input);
    const call = {
      path: url.pathname.replace(`/api/boards/${boardId}`, '~'),
      method: options.method ?? 'GET',
      body: options.body ? JSON.parse(options.body) : undefined,
    };
    requests.push(call);
    const custom = await override?.(call, state);
    if (custom) return custom;
    if (call.path === '/api/workspaces')
      return response(
        page(workspaces, Number(url.searchParams.get('page')), 20),
      );
    if (call.path === '~') return result(state.board);
    if (call.path === '~/policy-capabilities')
      return result({
        canInviteMembers: false,
        canChangeMembership: false,
        canChangeVisibility: false,
        ...policy,
      });
    if (call.path === '~/user-state')
      return result({ isStarred: false, lastViewedAt: null });
    if (call.path === '~/archive') {
      state.board = {
        ...state.board,
        isArchived: true,
        archivedAt: '2026-11-15T09:00:00.000Z',
        capabilities: capabilities(true, true),
      };
      return result(state.board);
    }
    if (call.path === '~/restore') {
      state.board = {
        ...state.board,
        isArchived: false,
        archivedAt: null,
        capabilities: capabilities(true),
      };
      return result(state.board);
    }
    if (call.path === '~/visibility') {
      state.board = { ...state.board, visibility: call.body.visibility };
      return result(state.board);
    }
    if (call.path === '~/move-workspace') {
      state.board = {
        ...state.board,
        workspaceId: call.body.destinationWorkspaceId,
        visibility: 'PRIVATE',
      };
      return result(state.board);
    }
    return failure(404, 'NOT_FOUND');
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
  const realtime = createNativeRealtime({
    manager,
    data,
    createSocket: null,
    timers: time,
  });
  realtime.setEnvironment({ foreground: true, online: true });
  realtime.start();
  const adapter = createNavigationSessionAdapter(manager);
  const mounted = await render(
    <SessionProvider manager={manager}>
      <DataProvider layer={data}>
        <RealtimeProvider client={realtime}>
          <NavigationProvider adapter={adapter}>
            <ThemeContext.Provider value="dark">
              <SettingsRoute />
            </ThemeContext.Provider>
          </NavigationProvider>
        </RealtimeProvider>
      </DataProvider>
    </SessionProvider>,
  );
  await screen.findByRole('header', { name: 'Board settings' });
  return {
    data,
    state,
    time,
    calls: (path, method = 'GET') =>
      requests.filter((call) => call.path === path && call.method === method),
    async dispose() {
      await mounted.unmount();
      realtime.dispose();
      data.dispose();
      manager.dispose();
      onlineManager.setOnline(true);
    },
  };
}

const button = (name) => screen.findByRole('button', { name });
const ownerActions = [
  'Edit details and background',
  'Change visibility',
  'Move to another workspace',
  'Archive board',
];

test('an explicit active owner sees every permitted action without extra reads', async () => {
  const env = await setup();
  try {
    for (const name of ownerActions) await button(name);
    expect(screen.queryByRole('button', { name: 'Restore board' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Remove sample board' }),
    ).toBeNull();
    expect(
      screen.getByLabelText('Workspace: Product team (Personal)'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Your role: Owner')).toBeTruthy();
    expect(env.calls('~')).toHaveLength(1);
    expect(env.calls('~/policy-capabilities')).toHaveLength(1);
    // A non-starter Board never asks for a sample-removal review.
    expect(env.calls('~/sample-removal')).toHaveLength(0);
  } finally {
    await env.dispose();
  }
});

test.each([
  ['Board member', makeBoard({ currentUserRole: 'MEMBER' }), 'Member'],
  [
    'Workspace-only reader',
    makeBoard({ currentUserRole: null, visibility: 'WORKSPACE_VISIBLE' }),
    'Workspace viewer · Read only',
  ],
  [
    'Workspace ADMIN without explicit Board OWNER',
    // Even a capability hint never substitutes for the explicit OWNER role.
    makeBoard({
      currentUserRole: 'MEMBER',
      isStarterBoard: true,
      capabilities: { ...capabilities(true), canRestoreBoard: true },
    }),
    'Member',
  ],
])('%s gets read-only details only', async (_name, board, role) => {
  const env = await setup({
    board,
    workspaces: [{ ...source, role: 'ADMIN', canManage: true }, team],
  });
  try {
    expect(screen.getByLabelText(`Your role: ${role}`)).toBeTruthy();
    await screen.findByText('Only the board owner can change these settings.');
    for (const name of [
      ...ownerActions,
      'Restore board',
      'Remove sample board',
    ])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(env.calls('~/policy-capabilities')).toHaveLength(0);
    expect(env.calls('~/sample-removal')).toHaveLength(0);
  } finally {
    await env.dispose();
  }
});

test('policy that forbids visibility changes hides the control and explains why', async () => {
  const env = await setup({ policy: { canChangeVisibility: false } });
  try {
    await screen.findByText('Workspace rules do not allow visibility changes.');
    expect(
      screen.queryByRole('button', { name: 'Change visibility' }),
    ).toBeNull();
    await button('Move to another workspace');
  } finally {
    await env.dispose();
  }
});

test('archive confirms once, becomes read-only and offers restore', async () => {
  const gate = deferred();
  const env = await setup({
    override: (call) =>
      call.path === '~/archive' ? gate.promise.then(() => null) : null,
  });
  try {
    await fireEvent.press(await button('Archive board'));
    await screen.findByText(/become read only/);
    const confirm = screen
      .getAllByRole('button', { name: 'Archive board' })
      .at(-1);
    await fireEvent.press(confirm);
    await fireEvent.press(confirm);
    await act(async () => gate.resolve());
    await screen.findByText(
      'Board “Launch plan” archived. It is now read only.',
    );
    expect(env.calls('~/archive', 'POST')).toHaveLength(1);
    await button('Restore board');
    for (const name of ownerActions)
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.getByLabelText('Status: Archived · Read only')).toBeTruthy();
    // One authoritative re-read after the command; no refetch storm.
    await waitFor(() => expect(env.calls('~').length).toBe(2));
    expect(env.calls('~').length).toBeLessThanOrEqual(2);
  } finally {
    await env.dispose();
  }
});

test('an archived owner restores the Board with the same identity', async () => {
  const env = await setup({ board: makeBoard({ isArchived: true }) });
  try {
    await screen.findByText(
      'This board is archived. It can be viewed but no longer changed.',
    );
    expect(screen.queryByRole('button', { name: 'Archive board' })).toBeNull();
    await fireEvent.press(await button('Restore board'));
    await fireEvent.press(
      screen.getAllByRole('button', { name: 'Restore board' }).at(-1),
    );
    await screen.findByText('Board “Launch plan” restored.');
    expect(env.calls('~/restore', 'POST')).toHaveLength(1);
    await button('Archive board');
    expect(env.state.board.id).toBe(boardId);
  } finally {
    await env.dispose();
  }
});

test('widening visibility warns about workspace reads and sends the shared enum', async () => {
  const env = await setup();
  try {
    await fireEvent.press(await button('Change visibility'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Workspace' }));
    await screen.findByText(/Everyone in this workspace will be able to read/);
    await fireEvent.press(await button('Share with workspace'));
    await screen.findByText('Board visibility updated to Workspace.');
    expect(env.calls('~/visibility', 'PATCH')[0].body).toEqual({
      visibility: 'WORKSPACE_VISIBLE',
    });
    expect(screen.getByLabelText('Visibility: Workspace')).toBeTruthy();
  } finally {
    await env.dispose();
  }
});

test('narrowing visibility warns that workspace readers lose access', async () => {
  const env = await setup({
    board: makeBoard({ visibility: 'WORKSPACE_VISIBLE' }),
  });
  try {
    await fireEvent.press(await button('Change visibility'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Private' }));
    await screen.findByText(/will lose their read-only access/);
  } finally {
    await env.dispose();
  }
});

test('a visibility conflict closes the sheet and rechecks the Board', async () => {
  const env = await setup({
    override: (call) =>
      call.path === '~/visibility'
        ? failure(409, 'CONFLICT', 'Board is archived')
        : null,
  });
  try {
    await fireEvent.press(await button('Change visibility'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Workspace' }));
    await fireEvent.press(await button('Share with workspace'));
    await screen.findByText(
      'This board changed meanwhile. Review the latest details and try again.',
    );
    expect(screen.queryByRole('radio', { name: 'Workspace' })).toBeNull();
    await waitFor(() => expect(env.calls('~').length).toBe(2));
    expect(screen.getByLabelText('Visibility: Private')).toBeTruthy();
  } finally {
    await env.dispose();
  }
});

test('a transient visibility failure keeps the sheet and the choice', async () => {
  const env = await setup({
    override: (call) =>
      call.path === '~/visibility' ? failure(503, 'UNAVAILABLE') : null,
  });
  try {
    await fireEvent.press(await button('Change visibility'));
    await fireEvent.press(screen.getByRole('radio', { name: 'Workspace' }));
    await fireEvent.press(await button('Share with workspace'));
    await screen.findByText('Couldn’t load the latest data. Try again.');
    expect(
      screen.getByRole('radio', { name: 'Workspace' }).props.accessibilityState
        .checked,
    ).toBe(true);
  } finally {
    await env.dispose();
  }
});

test('move offers only other joined workspaces that allow Board creation and resets to Private', async () => {
  const env = await setup({
    board: makeBoard({ visibility: 'WORKSPACE_VISIBLE' }),
  });
  try {
    await fireEvent.press(await button('Move to another workspace'));
    await screen.findByRole('radio', { name: 'Design team' });
    expect(screen.queryByRole('radio', { name: /Product team/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Locked team' })).toBeNull();
    await screen.findByText(/The board will become Private in the destination/);
    await screen.findByText(/Members of Product team who relied on workspace/);
    expect(
      (await button('Choose a workspace')).props.accessibilityState.disabled,
    ).toBe(true);
    await fireEvent.press(screen.getByRole('radio', { name: 'Design team' }));
    await fireEvent.press(await button('Move to Design team'));
    await screen.findByText(/Board moved to Design team/);
    expect(env.calls('~/move-workspace', 'POST')[0].body).toEqual({
      destinationWorkspaceId: team.id,
    });
    expect(screen.getByLabelText('Visibility: Private')).toBeTruthy();
    expect(screen.getByLabelText('Workspace: Design team')).toBeTruthy();
  } finally {
    await env.dispose();
  }
});

test('a denied command rechecks access and shows the Board as unavailable', async () => {
  const env = await setup({
    override: (call, state) => {
      if (call.path === '~/archive') {
        state.denied = true;
        return failure(403, 'FORBIDDEN');
      }
      return call.path === '~' && state.denied ? failure(404) : null;
    },
  });
  try {
    await fireEvent.press(await button('Archive board'));
    await fireEvent.press(
      screen.getAllByRole('button', { name: 'Archive board' }).at(-1),
    );
    // The MOB-06 access probe, not the failed command, decides Board loss.
    await waitFor(() => expect(env.calls('~').length).toBeGreaterThan(1));
    await act(async () => env.time.advance(50));
    await screen.findByText('Board unavailable');
    expect(screen.queryByText('Launch plan')).toBeNull();
    expect(
      env.data.queryClient.getQueryData([
        ...queryKeys.board(env.data.getIdentity(), boardId),
        'settings',
      ]),
    ).toBeUndefined();
  } finally {
    await env.dispose();
  }
});

test('offline keeps details visible but blocks commands', async () => {
  const env = await setup();
  try {
    await button('Archive board');
    await act(async () => onlineManager.setOnline(false));
    await screen.findByText('Connection unavailable');
    expect(screen.queryByRole('button', { name: 'Archive board' })).toBeNull();
  } finally {
    await env.dispose();
  }
});

function samplePreview(customized, version) {
  return result({
    boardName: 'Welcome to Kanvexa',
    isCustomized: customized,
    version,
    confirmation: customized
      ? 'DELETE MY CUSTOMIZED BOARD'
      : 'REMOVE SAMPLE BOARD',
  });
}

test('sample removal needs the exact server phrase and sends its version once', async () => {
  const env = await setup({
    board: makeBoard({ isStarterBoard: true }),
    override: (call) => {
      if (call.path !== '~/sample-removal') return null;
      return call.method === 'GET'
        ? samplePreview(false, version1)
        : response(null, 204);
    },
  });
  try {
    await fireEvent.press(await button('Remove sample board'));
    const field = await screen.findByLabelText(
      'Type REMOVE SAMPLE BOARD to confirm',
    );
    const remove = () =>
      screen.getAllByRole('button', { name: 'Remove sample board' }).at(-1);
    await fireEvent.changeText(field, 'remove sample board');
    expect(remove().props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(field, 'REMOVE SAMPLE BOARD');
    await fireEvent.press(remove());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/boards'));
    expect(env.calls('~/sample-removal', 'DELETE')).toEqual([
      {
        path: '~/sample-removal',
        method: 'DELETE',
        body: { version: version1, confirmation: 'REMOVE SAMPLE BOARD' },
      },
    ]);
    expect(
      env.data.queryClient.getQueryData([
        ...queryKeys.board(env.data.getIdentity(), boardId),
        'settings',
      ]),
    ).toBeUndefined();
  } finally {
    await env.dispose();
  }
});

test('a changed sample requires a fresh review with the stronger phrase', async () => {
  let reviews = 0;
  const env = await setup({
    board: makeBoard({ isStarterBoard: true }),
    override: (call) => {
      if (call.path !== '~/sample-removal') return null;
      if (call.method === 'GET')
        return ++reviews === 1
          ? samplePreview(false, version1)
          : samplePreview(true, version2);
      return call.body.version === version1
        ? failure(409, 'STARTER_BOARD_CHANGED', 'The sample board changed.')
        : response(null, 204);
    },
  });
  try {
    await fireEvent.press(await button('Remove sample board'));
    await fireEvent.changeText(
      await screen.findByLabelText('Type REMOVE SAMPLE BOARD to confirm'),
      'REMOVE SAMPLE BOARD',
    );
    await fireEvent.press(
      screen.getAllByRole('button', { name: 'Remove sample board' }).at(-1),
    );
    const stronger = await screen.findByLabelText(
      'Type DELETE MY CUSTOMIZED BOARD to confirm',
    );
    await screen.findByText(/The sample board changed\. Review the updated/);
    await screen.findByText(/permanently delete your customized work/);
    expect(stronger.props.value).toBe('');
    expect(env.calls('~/sample-removal', 'DELETE')).toHaveLength(1);
    expect(mockReplace).not.toHaveBeenCalled();
    await fireEvent.changeText(stronger, 'DELETE MY CUSTOMIZED BOARD');
    await fireEvent.press(
      screen.getAllByRole('button', { name: 'Remove sample board' }).at(-1),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/boards'));
    expect(env.calls('~/sample-removal', 'DELETE')[1].body).toEqual({
      version: version2,
      confirmation: 'DELETE MY CUSTOMIZED BOARD',
    });
  } finally {
    await env.dispose();
  }
});

test('an unsafe sample is never offered for removal', async () => {
  const env = await setup({
    board: makeBoard({ isStarterBoard: true, visibility: 'WORKSPACE_VISIBLE' }),
    override: (call) =>
      call.path === '~/sample-removal'
        ? failure(409, 'STARTER_BOARD_REMOVAL_UNSAFE', 'Unsafe')
        : null,
  });
  try {
    await screen.findByText(/Sample removal is unavailable for shared boards/);
    expect(
      screen.queryByRole('button', { name: 'Remove sample board' }),
    ).toBeNull();
    expect(env.calls('~/sample-removal', 'DELETE')).toHaveLength(0);
  } finally {
    await env.dispose();
  }
});

test('Android back closes an open sheet before leaving the screen', async () => {
  const env = await setup();
  try {
    await fireEvent.press(await button('Move to another workspace'));
    await screen.findByRole('radio', { name: 'Design team' });
    await fireEvent(screen.getByTestId('native-modal'), 'touchEnd');
    await waitFor(() =>
      expect(screen.queryByRole('radio', { name: 'Design team' })).toBeNull(),
    );
    await button('Archive board');
    expect(mockPush).not.toHaveBeenCalled();
  } finally {
    await env.dispose();
  }
});

test('a background re-review clears a phrase typed for the previous version', async () => {
  let reviews = 0;
  const env = await setup({
    board: makeBoard({ isStarterBoard: true }),
    override: (call) =>
      call.path === '~/sample-removal' && call.method === 'GET'
        ? samplePreview(false, ++reviews === 1 ? version1 : version2)
        : null,
  });
  try {
    await fireEvent.press(await button('Remove sample board'));
    await fireEvent.changeText(
      await screen.findByLabelText('Type REMOVE SAMPLE BOARD to confirm'),
      'REMOVE SAMPLE BOARD',
    );
    await act(() =>
      env.data.queryClient.refetchQueries({
        queryKey: [
          ...queryKeys.board(env.data.getIdentity(), boardId),
          'settings',
          'sample-removal',
        ],
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText('Type REMOVE SAMPLE BOARD to confirm').props
          .value,
      ).toBe(''),
    );
    expect(env.calls('~/sample-removal', 'DELETE')).toHaveLength(0);
  } finally {
    await env.dispose();
  }
});
