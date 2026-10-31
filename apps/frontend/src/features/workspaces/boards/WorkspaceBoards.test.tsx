import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../../app/routes';
import { ApiError } from '../../../lib/api-client';
import { makeBoard, okPage } from '../../../test/board-fixtures';
import { receiveBoardRevocation } from '../../realtime/access-revocation';
import { boardKeys } from '../../boards/query-keys';
import {
  mockApi,
  ok,
  fail,
  storeSession,
  testUser,
  type MockRequest,
  type MockResponse,
} from '../../../test/mock-api';
import { AuthProvider } from '../../auth/AuthProvider';
import { RealtimeProvider } from '../../realtime/RealtimeProvider';
import type { WorkspaceGateway } from '../api';
import { WorkspaceGatewayContext } from '../gateway-context';
import { workspaceKeys } from '../query-keys';
import type { WorkspaceOverview, WorkspaceSummary } from '../types';
import {
  WorkspaceBoardsGatewayContext,
  workspaceBoardsGateway as realBoardsGateway,
} from './gateway';
import type {
  WorkspaceBoardSummary,
  WorkspaceBoardsGateway,
  WorkspaceBoardsPageData,
} from './types';

const workspaceBoardsGateway = {
  ...realBoardsGateway,
  available: false,
  features: { search: false, status: false, sorts: [], pagination: false },
};
const space: WorkspaceSummary = {
  id: 'space-one',
  name: 'Engineering workspace',
  description: 'Build together.',
  type: 'TEAM',
  role: 'ADMIN',
  canCreateBoards: true,
};
const other: WorkspaceSummary = {
  ...space,
  id: 'space-two',
  name: 'Other workspace',
};
const board: WorkspaceBoardSummary = {
  id: 'board-one',
  name: 'Authorized board',
  description: null,
  updatedAt: '2026-10-27T09:00:00Z',
  isArchived: false,
  visibility: 'PRIVATE',
  currentUserRole: 'OWNER',
  canArchive: true,
  canRestore: true,
  memberCount: null,
};
const page: WorkspaceBoardsPageData = {
  items: [board],
  total: 1,
  page: 1,
  pageCount: 1,
};
function gateway(
  overrides: Partial<WorkspaceBoardsGateway> = {},
): WorkspaceBoardsGateway {
  return {
    available: true,
    features: {
      search: true,
      status: true,
      sorts: ['updated-desc', 'name-asc'],
      pagination: true,
    },
    list: vi.fn(async (_token, id) =>
      id === other.id
        ? {
            ...page,
            items: [
              { ...board, id: 'other-board', name: 'Other authorized board' },
            ],
          }
        : page,
    ),
    create: vi.fn(async () => ({ id: 'new-board' })),
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
type Handler =
  | MockResponse
  | ((request: MockRequest) => MockResponse | Promise<MockResponse>);
function mount(
  path = `/workspaces/${space.id}/boards`,
  boards = gateway(),
  handlers: Record<string, Handler> = {},
  canCreateBoards = true,
) {
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    ...Object.fromEntries(
      ['board-one', 'new-board'].flatMap((id) => [
        [
          `GET /boards/${id}`,
          ok(
            makeBoard({
              id,
              name: id === 'new-board' ? 'Created board' : board.name,
            }),
          ),
        ],
        ...['cards', 'columns', 'members'].map((resource) => [
          `GET /boards/${id}/${resource}?page=1&limit=100`,
          okPage([]),
        ]),
      ]),
    ),
    ...handlers,
  });
  const workspace: WorkspaceGateway = {
    available: true,
    list: vi.fn(async () => [space, other]),
    overview: vi.fn(async (_token, id) => ({
      workspace: { ...(id === other.id ? other : space), canCreateBoards },
      visibleBoardCount: 1,
      memberCount: null,
      recentBoards: [],
    })),
    createTeam: vi.fn(async () => space),
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RealtimeProvider>
          <WorkspaceGatewayContext.Provider value={workspace}>
            <WorkspaceBoardsGatewayContext.Provider value={boards}>
              <RouterProvider
                router={router}
                flushSync={(callback) => {
                  flushSync(callback);
                }}
              />
            </WorkspaceBoardsGatewayContext.Provider>
          </WorkspaceGatewayContext.Provider>
        </RealtimeProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, router, client, boards, workspace, calls };
}
async function ready() {
  return screen.findByRole('link', { name: `Open ${board.name}` });
}
function main() {
  return within(screen.getByRole('main'));
}
async function openCreate() {
  await ready();
  fireEvent.click(main().getByRole('button', { name: 'Create Board' }));
  return screen.findByRole('dialog', { name: 'Create a new board' });
}
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem('kanvexa.sidebar.expanded');
});

describe('Workspace Boards route and capabilities', () => {
  it('shares identity and active Boards navigation with correct breadcrumb', async () => {
    mount();
    await ready();
    expect(
      main().getByRole('heading', { level: 1, name: space.name }),
    ).toBeTruthy();
    const crumbs = main().getByRole('navigation', {
      name: 'Workspace breadcrumb',
    });
    expect(crumbs.textContent).toBe(`Workspaces${space.name}Boards`);
    expect(
      within(crumbs).getByText('Boards').getAttribute('aria-current'),
    ).toBe('page');
    const nav = main().getByRole('navigation', { name: 'Workspace sections' });
    expect(
      within(nav)
        .getByRole('link', { name: 'Boards' })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(nav)
        .getByRole('link', { name: 'Members' })
        .getAttribute('aria-current'),
    ).toBeNull();
  });
  it('keeps all unavailable toolbar/grid/create/pagination slots without guessed requests', async () => {
    const { calls } = mount(undefined, workspaceBoardsGateway);
    await screen.findByRole('heading', {
      name: 'Workspace boards unavailable',
    });
    expect(
      (
        main().getByRole('searchbox', {
          name: 'Search workspace boards',
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        main().getByRole('combobox', {
          name: 'Sort workspace boards',
        }) as HTMLSelectElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        main().getByRole('button', {
          name: 'Create Board',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      main().getByRole('group', { name: 'Board pagination' }),
    ).toBeTruthy();
    expect(
      calls.some(
        (c) => c.path.includes('/workspaces') || c.path.startsWith('/boards'),
      ),
    ).toBe(false);
    expect(main().queryByRole('link', { name: /Open / })).toBeNull();
  });
  it('does not infer board mutations or creation from Workspace ADMIN', async () => {
    mount(
      undefined,
      gateway({
        list: async () => ({
          ...page,
          items: [{ ...board, currentUserRole: 'MEMBER' }],
        }),
      }),
      {},
      false,
    );
    await ready();
    expect(
      (
        main().getByRole('button', {
          name: 'Create Board',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      main().queryByRole('button', { name: `Actions for ${board.name}` }),
    ).toBeNull();
    expect(
      main().getByText(/You do not have permission to create/),
    ).toBeTruthy();
  });
  it('gates unsupported search/status/sort and does not honor unsupported URL values', async () => {
    const api = gateway({
      features: { search: false, status: false, sorts: [], pagination: false },
    });
    mount(
      `/workspaces/${space.id}/boards?q=secret&status=archived&sort=name-asc&page=99`,
      api,
    );
    await ready();
    expect(api.list).toHaveBeenCalledWith(
      'stored-token',
      space.id,
      { search: '', status: 'active', sort: 'updated-desc', page: 1 },
      expect.any(AbortSignal),
    );
    expect((main().getByRole('searchbox') as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      (main().getByRole('button', { name: 'Archived' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      main().queryByRole('button', { name: /Starred|Recent|List/ }),
    ).toBeNull();
  });
  it('renders only returned authorized metadata without fetching members or backgrounds', async () => {
    const { calls } = mount();
    await ready();
    expect(main().getByText('Private')).toBeTruthy();
    expect(main().getByText('Board member count private')).toBeTruthy();
    expect(calls.some((c) => /members|background/.test(c.path))).toBe(false);
    expect(main().queryByText(/WORKSPACE_VISIBLE/)).toBeNull();
    expect(
      main().getByText('Star board, coming soon').closest('a, button'),
    ).toBeNull();
  });

  it.each([0, 1, 7, null])(
    'renders the authorized Board count %s without roster requests',
    async (memberCount) => {
      const { calls } = mount(
        undefined,
        gateway({
          list: async () => ({ ...page, items: [{ ...board, memberCount }] }),
        }),
      );
      await ready();
      expect(
        main().getByText(
          memberCount === null
            ? 'Board member count private'
            : `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`,
        ),
      ).toBeTruthy();
      expect(calls.some((c) => c.path.includes('/members'))).toBe(false);
    },
  );

  it('shows a Workspace-visible read-only Board without owner actions', async () => {
    mount(
      undefined,
      gateway({
        list: async () => ({
          ...page,
          items: [
            {
              ...board,
              name: 'Shared view',
              visibility: 'WORKSPACE_VISIBLE',
              currentUserRole: null,
              canArchive: false,
              canRestore: false,
            },
          ],
        }),
      }),
    );
    await screen.findByRole('link', { name: 'Open Shared view' });
    expect(main().getByText('Workspace visible')).toBeTruthy();
    expect(main().queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('keeps the mobile drawer and restores creation focus without nested dialogs', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    mount();
    await ready();
    const menu = screen.getByRole('button', { name: 'Open navigation' });
    menu.focus();
    fireEvent.click(menu);
    const drawer = await screen.findByRole('dialog', {
      name: 'Navigation menu',
    });
    fireEvent.click(
      await within(drawer).findByRole('link', { name: other.name }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(
      within(
        main().getByRole('navigation', { name: 'Workspace sections' }),
      ).getByRole('link', { name: 'Boards' }),
    );
    const create = await main().findByRole('button', { name: 'Create Board' });
    await waitFor(() =>
      expect((create as HTMLButtonElement).disabled).toBe(false),
    );
    create.focus();
    fireEvent.click(create);
    const dialog = await screen.findByRole('dialog', {
      name: 'Create a new board',
    });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(document.activeElement).toBe(
      within(dialog).getByLabelText('Board name'),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(create);
  });
  it('navigates to the existing Board route and returns through Back', async () => {
    const { router } = mount();
    fireEvent.click(await ready());
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/boards/board-one'),
    );
    await screen.findByRole('heading', { name: board.name });
    await act(() => router.navigate(-1));
    await ready();
  });
  it('enters Overview when switching Workspace and supports Back/Forward', async () => {
    const api = gateway({
      list: vi.fn(async (_token, id) =>
        id === other.id ? { ...page, items: [], total: 0 } : page,
      ),
    });
    const { router } = mount(undefined, api);
    await ready();
    fireEvent.click(screen.getByRole('link', { name: other.name }));
    await screen.findByRole('heading', { name: 'No accessible boards yet' });
    expect(router.state.location.pathname).toBe(`/workspaces/${other.id}`);
    expect(
      main().queryByRole('link', { name: `Open ${board.name}` }),
    ).toBeNull();
    await act(() => router.navigate(-1));
    await ready();
    await act(() => router.navigate(1));
    await screen.findByRole('heading', { name: 'No accessible boards yet' });
  });
});

describe('Server-backed filtering seam', () => {
  it('preserves every character while router transitions receive fast typing', async () => {
    const api = gateway({ list: vi.fn(async () => page) });
    mount(undefined, api);
    await ready();
    const input = main().getByRole('searchbox') as HTMLInputElement;
    // A browser reads the current controlled value for each incoming key.
    // Keep the events in one transition window to catch stale URL renders.
    act(() => {
      for (const character of 'No matching board') {
        fireEvent.change(input, { target: { value: input.value + character } });
      }
    });
    expect(input.value).toBe('No matching board');
    await waitFor(() =>
      expect(vi.mocked(api.list).mock.lastCall?.[2].search).toBe(
        'No matching board',
      ),
    );
  });
  it('debounces search, hides previous results and never filters a broad response in React', async () => {
    const api = gateway({
      list: vi.fn(async (_token, _id, filters) =>
        filters.search
          ? { ...page, items: [{ ...board, name: 'Server match' }], total: 40 }
          : page,
      ),
    });
    mount(undefined, api);
    await ready();
    const input = main().getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'alpha' } });
    expect(
      main().queryByRole('link', { name: `Open ${board.name}` }),
    ).toBeNull();
    await screen.findByRole('link', { name: 'Open Server match' });
    expect(main().getByText(/40 accessible boards/)).toBeTruthy();
    expect(
      vi
        .mocked(api.list)
        .mock.calls.filter((call) => call[2].search)
        .map((call) => call[2].search),
    ).toEqual(['alpha']);
  });
  it('sends status, sort and page to the gateway, resetting pagination on filter changes', async () => {
    const api = gateway({
      list: vi.fn(async (_token, _id, filters) => ({
        ...page,
        page: filters.page,
        pageCount: 5,
        total: 30,
      })),
    });
    const { router } = mount(`/workspaces/${space.id}/boards?page=3`, api);
    await ready();
    fireEvent.click(main().getByRole('button', { name: 'Archived' }));
    await waitFor(() =>
      expect(vi.mocked(api.list).mock.lastCall?.[2]).toEqual({
        search: '',
        status: 'archived',
        sort: 'updated-desc',
        page: 1,
      }),
    );
    fireEvent.change(main().getByRole('combobox'), {
      target: { value: 'name-asc' },
    });
    await waitFor(() =>
      expect(vi.mocked(api.list).mock.lastCall?.[2].sort).toBe('name-asc'),
    );
    fireEvent.click(await main().findByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(vi.mocked(api.list).mock.lastCall?.[2].page).toBe(2),
    );
    expect(router.state.location.search).toContain('page=2');
    fireEvent.click(main().getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });
  it('distinguishes no Boards from no matching search results', async () => {
    const { router } = mount(
      undefined,
      gateway({
        list: async () => ({ ...page, items: [], total: 0, pageCount: 0 }),
      }),
    );
    await screen.findByRole('heading', { name: 'No accessible boards yet' });
    await act(() => router.navigate(`/workspaces/${space.id}/boards?q=none`));
    await screen.findByRole('heading', { name: 'No matching boards' });
    fireEvent.click(main().getByRole('button', { name: 'Clear filters' }));
    await screen.findByRole('heading', { name: 'No accessible boards yet' });
  });
  it('uses a real loading grid and cancels the previous request on Workspace switch', async () => {
    const pending = deferred<WorkspaceBoardsPageData>();
    let signal: AbortSignal | undefined;
    const api = gateway({
      list: vi.fn((_token, id, _filters, s) => {
        if (id === space.id) {
          signal = s;
          return pending.promise;
        }
        return Promise.resolve({ ...page, items: [], total: 0 });
      }),
    });
    const { router } = mount(undefined, api);
    await screen.findByText('Loading workspace boards');
    await waitFor(() => expect(signal).toBeDefined());
    await act(() => router.navigate(`/workspaces/${other.id}/boards`));
    await screen.findByRole('heading', { name: 'No accessible boards yet' });
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(page));
    expect(document.body.textContent).not.toContain(board.name);
  });
  it('shows network failure and retries without presenting stale cards', async () => {
    const list = vi
      .fn<WorkspaceBoardsGateway['list']>()
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'))
      .mockResolvedValue(page);
    mount(undefined, gateway({ list }));
    await screen.findByRole('heading', { name: 'Could not load workspace' });
    expect(
      main().queryByRole('link', { name: `Open ${board.name}` }),
    ).toBeNull();
    fireEvent.click(main().getByRole('button', { name: 'Try again' }));
    await ready();
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('Workspace Board creation', () => {
  it('reuses Board validation, normalizes input, prevents duplicates and navigates after success', async () => {
    const pending = deferred<{ id: string }>();
    const create = vi.fn(() => pending.promise);
    const { router } = mount(undefined, gateway({ create }));
    const dialog = await openCreate();
    fireEvent.submit(dialog.querySelector('form')!);
    expect(within(dialog).getByText('Enter a board name.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Board name'), {
      target: { value: '  Sprint  ' },
    });
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: '  Plan  ' },
    });
    fireEvent.submit(dialog.querySelector('form')!);
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith('stored-token', space.id, {
      name: 'Sprint',
      description: 'Plan',
    });
    expect(router.state.location.pathname).toBe(
      `/workspaces/${space.id}/boards`,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => pending.resolve({ id: 'new-board' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/boards/new-board'),
    );
  });
  it('retains a failed draft and supports retry', async () => {
    const create = vi
      .fn<WorkspaceBoardsGateway['create']>()
      .mockRejectedValueOnce(
        new ApiError(0, 'NETWORK_ERROR', 'Check your connection.'),
      )
      .mockResolvedValue({ id: 'new-board' });
    mount(undefined, gateway({ create }));
    const dialog = await openCreate();
    const input = within(dialog).getByLabelText('Board name');
    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    fireEvent.submit(dialog.querySelector('form')!);
    await within(dialog).findByRole('alert');
    expect((input as HTMLInputElement).value).toBe('Keep this draft');
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('renders a complete unavailable form and never uses the old unscoped create endpoint', async () => {
    const { calls } = mount(
      `/workspaces/${space.id}/boards?create=board`,
      workspaceBoardsGateway,
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Board name')).toBeTruthy();
    expect(within(dialog).getByLabelText('Description')).toBeTruthy();
    expect(
      (
        within(dialog).getByRole('button', {
          name: 'Create unavailable',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.submit(dialog.querySelector('form')!);
    expect(calls.some((c) => c.method === 'POST' && c.path === '/boards')).toBe(
      false,
    );
  });
  it('does not navigate when a late creation result belongs to a closed route', async () => {
    const pending = deferred<{ id: string }>();
    const { router } = mount(
      undefined,
      gateway({ create: () => pending.promise }),
    );
    const dialog = await openCreate();
    fireEvent.change(within(dialog).getByLabelText('Board name'), {
      target: { value: 'Late board' },
    });
    fireEvent.submit(dialog.querySelector('form')!);
    await within(dialog).findByRole('button', { name: 'Creating…' });
    await act(() => router.navigate(`/workspaces/${other.id}/boards`));
    await act(async () => pending.resolve({ id: 'new-board' }));
    expect(router.state.location.pathname).toBe(
      `/workspaces/${other.id}/boards`,
    );
  });
});

describe('Existing archive and restore REST integration', () => {
  it('does not recreate Board cache from an archive response arriving after revocation', async () => {
    const pending = deferred<MockResponse>();
    let revoked = false;
    const { client, calls } = mount(
      undefined,
      gateway({
        list: async () => ({ ...page, items: revoked ? [] : [board] }),
      }),
      { [`POST /boards/${board.id}/archive`]: () => pending.promise },
    );
    await screen.findByRole('link', { name: new RegExp(`Open ${board.name}`) });
    client.setQueryData(
      boardKeys.detail(board.id),
      makeBoard({ id: board.id }),
    );
    fireEvent.click(
      main().getByRole('button', { name: `Actions for ${board.name}` }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive board' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Archive board' }),
    );
    await waitFor(() =>
      expect(calls.some((call) => call.method === 'POST')).toBe(true),
    );
    act(() => {
      revoked = true;
      receiveBoardRevocation(client, { boardId: board.id });
    });
    await act(async () =>
      pending.resolve(ok(makeBoard({ id: board.id, isArchived: true }))),
    );
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(client.getQueryData(boardKeys.detail(board.id))).toBeUndefined();
  });
  it.each([false, true])(
    'confirms and refreshes the existing %s archived-state mutation',
    async (isArchived) => {
      let changed = false;
      const current = { ...board, isArchived };
      const action = isArchived ? 'Restore' : 'Archive';
      const api = gateway({
        list: vi.fn(async () => ({ ...page, items: changed ? [] : [current] })),
      });
      const { calls } = mount(
        `/workspaces/${space.id}/boards${isArchived ? '?status=archived' : ''}`,
        api,
        {
          [`POST /boards/${board.id}/${isArchived ? 'restore' : 'archive'}`]:
            () => {
              changed = true;
              return ok(makeBoard({ id: board.id, isArchived: !isArchived }));
            },
        },
      );
      await screen.findByRole('link', {
        name: new RegExp(`Open ${board.name}`),
      });
      if (isArchived)
        expect(main().getByText('Archived · Read only')).toBeTruthy();
      fireEvent.click(
        main().getByRole('button', { name: `Actions for ${board.name}` }),
      );
      fireEvent.click(screen.getByRole('button', { name: `${action} board` }));
      const dialog = await screen.findByRole('dialog');
      expect(calls.some((c) => c.method === 'POST')).toBe(false);
      fireEvent.click(
        within(dialog).getByRole('button', { name: `${action} board` }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(
        calls.some(
          (c) =>
            c.path ===
            `/boards/${board.id}/${isArchived ? 'restore' : 'archive'}`,
        ),
      ).toBe(true);
      expect(vi.mocked(api.list).mock.calls.length).toBeGreaterThan(1);
    },
  );
  it('does not offer restore when either capability or Board OWNER role is absent', async () => {
    mount(
      undefined,
      gateway({
        list: async () => ({
          ...page,
          items: [
            { ...board, isArchived: true, canRestore: false },
            {
              ...board,
              id: 'member-board',
              name: 'Member board',
              isArchived: true,
              currentUserRole: 'MEMBER',
            },
          ],
        }),
      }),
    );
    await screen.findByRole('link', { name: new RegExp(`Open ${board.name}`) });
    expect(main().queryByRole('button', { name: /Actions for/ })).toBeNull();
  });
  it('clears Board-sensitive lists and Overview recents when archive is rejected', async () => {
    const { client, workspace } = mount(undefined, gateway(), {
      'POST /boards/board-one/archive': fail(403, 'FORBIDDEN'),
    });
    await ready();
    const refresh = deferred<WorkspaceOverview>();
    workspace.overview = () => refresh.promise;
    const overviewKey = workspaceKeys.overview(testUser.id, 0, space.id);
    await act(async () =>
      client.setQueryData<WorkspaceOverview>(overviewKey, {
        workspace: space,
        visibleBoardCount: 1,
        memberCount: null,
        recentBoards: [
          {
            id: board.id,
            name: board.name,
            updatedAt: board.updatedAt!,
            archived: false,
            memberCount: null,
          },
        ],
      }),
    );
    fireEvent.click(
      main().getByRole('button', { name: `Actions for ${board.name}` }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive board' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Archive board',
      }),
    );
    await screen.findByRole('heading', { name: 'Could not load workspace' });
    expect(document.body.textContent).not.toContain(board.name);
    expect(
      JSON.stringify(
        client.getQueryData([
          ...workspaceKeys.boards(testUser.id, 0, space.id),
          { search: '', status: 'active', sort: 'updated-desc', page: 1 },
        ]),
      ),
    ).not.toContain(board.name);
    expect(client.getQueryData(overviewKey)).toBeNull();
    await act(async () =>
      refresh.resolve({
        workspace: space,
        visibleBoardCount: 0,
        memberCount: null,
        recentBoards: [],
      }),
    );
  });
});

describe('Access revocation and session isolation', () => {
  it.each([403, 404])(
    'clears header and every Boards filter cache on a %s refresh',
    async (status) => {
      const api = gateway();
      const { client } = mount(undefined, api);
      await ready();
      client.setQueryData(
        [
          ...workspaceKeys.boards(testUser.id, 0, space.id),
          { status: 'archived' },
        ],
        { ...page, items: [{ ...board, name: 'Cached private archive' }] },
      );
      api.list = vi.fn(async () => {
        throw new ApiError(status, 'DENIED', 'Confidential backend message');
      });
      await act(async () => {
        await client.invalidateQueries({
          queryKey: workspaceKeys.boards(testUser.id, 0, space.id),
        });
      });
      await screen.findByRole('heading', {
        name:
          status === 403
            ? 'Workspace access unavailable'
            : 'Workspace not found',
      });
      expect(document.body.textContent).not.toContain(board.name);
      expect(document.body.textContent).not.toContain(space.name);
      for (const q of client.getQueryCache().findAll({
        queryKey: workspaceKeys.resource(testUser.id, 0, space.id),
      }))
        expect(JSON.stringify(q.state.data)).not.toContain('Cached private');
    },
  );
  it('clears Board payloads when the shared Workspace identity query loses membership', async () => {
    const { client, workspace } = mount();
    await ready();
    workspace.overview = async () => {
      throw new ApiError(403, 'FORBIDDEN', 'Membership lost');
    };
    await act(async () => {
      await client.invalidateQueries({
        queryKey: workspaceKeys.overview(testUser.id, 0, space.id),
      });
    });
    await screen.findByRole('heading', {
      name: 'Workspace access unavailable',
    });
    expect(document.body.textContent).not.toContain(board.name);
    const payloads = client
      .getQueryCache()
      .findAll({ queryKey: workspaceKeys.boards(testUser.id, 0, space.id) })
      .map((q) => q.state.data);
    expect(JSON.stringify(payloads)).not.toContain(board.name);
  });
  it('rejects pending Account A results after switching to Account B', async () => {
    const pending = deferred<WorkspaceBoardsPageData>();
    const api = gateway({
      list: vi.fn((token) =>
        token === 'stored-token'
          ? pending.promise
          : Promise.reject(new ApiError(403, 'FORBIDDEN', 'Denied')),
      ),
    });
    const { client } = mount(undefined, api);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    mockApi({
      'GET /users/me': ok({
        ...testUser,
        id: 'account-b',
        displayName: 'Account B',
      }),
    });
    await act(async () => {
      storeSession('account-b-session');
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'kanban.session' }),
      );
    });
    await screen.findByRole('heading', {
      name: 'Workspace access unavailable',
    });
    await act(async () =>
      pending.resolve({ ...page, items: [{ ...board, memberCount: 99 }] }),
    );
    expect(document.body.textContent).not.toContain(board.name);
    expect(document.body.textContent).not.toContain('99 members');
    expect(
      client.getQueryData(workspaceKeys.overview(testUser.id, 0, space.id)),
    ).toBeUndefined();
  });
  it('handles expired sessions without keeping protected cards', async () => {
    const { router } = mount(
      undefined,
      gateway({
        list: async () => {
          throw new ApiError(401, 'UNAUTHORIZED', 'Expired');
        },
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(document.body.textContent).not.toContain(board.name);
  });
  it('clears a pending creation on logout and ignores its late success', async () => {
    const pending = deferred<{ id: string }>();
    const { router } = mount(
      undefined,
      gateway({ create: () => pending.promise }),
    );
    const dialog = await openCreate();
    fireEvent.change(within(dialog).getByLabelText('Board name'), {
      target: { value: 'Late board' },
    });
    fireEvent.submit(dialog.querySelector('form')!);
    await within(dialog).findByRole('button', { name: 'Creating…' });
    await act(async () => {
      localStorage.removeItem('kanban.session');
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'kanban.session' }),
      );
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    await act(async () => pending.resolve({ id: 'new-board' }));
    expect(router.state.location.pathname).toBe('/login');
  });
});
