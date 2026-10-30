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
import { describe, expect, it, vi } from 'vitest';
import { routes } from '../../../app/routes';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../../test/mock-api';
import {
  workspaceOverviewResponse,
  workspacePage,
  workspaceResponse,
} from '../../../test/workspace-fixtures';
import { createdSockets } from '../../../test/fake-socket';
import { AuthProvider } from '../../auth/AuthProvider';
import { RealtimeProvider } from '../../realtime/RealtimeProvider';
import type { WorkspaceResponse } from '../response';
import { workspaceKeys } from '../query-keys';
import { listWorkspaceGuests } from './api';
import { refreshWorkspaceGuests } from './refresh-guests';
import type { WorkspaceGuest } from './types';

const workspace = {
  ...workspaceResponse,
  role: 'ADMIN',
  canManage: true,
} satisfies WorkspaceResponse;
const id = workspace.id;
const base = `/workspaces/${id}`;
const path = `${base}/members?tab=guests`;
const endpoint = `GET ${base}/guests?page=1&limit=10`;
const guest: WorkspaceGuest = {
  user: { id: 'guest-1', displayName: 'Grace Guest', avatarUrl: null },
  boards: [
    {
      boardId: 'board-a',
      name: 'Design review',
      role: 'MEMBER',
      isArchived: false,
    },
    {
      boardId: 'board-b',
      name: 'Research archive',
      role: 'OWNER',
      isArchived: true,
    },
  ],
  visibleBoardCount: 2,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function mount(
  url = path,
  overrides: Parameters<typeof mockApi>[0] = {},
  summary: WorkspaceResponse = workspace,
) {
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    'GET /workspaces?page=1&limit=100': workspacePage([summary], 1, 1, 100),
    [`GET ${base}/overview`]: ok({
      ...workspaceOverviewResponse,
      workspace: summary,
    }),
    [`GET ${base}/members?page=1&limit=10`]: workspacePage([], 1, 0, 10),
    [`GET ${base}/invitations?page=1&limit=10`]: workspacePage([], 1, 0, 10),
    [endpoint]: workspacePage([guest], 1, 1, 10),
    ...overrides,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RealtimeProvider>
          <RouterProvider
            router={router}
            flushSync={(callback) => {
              flushSync(callback);
            }}
          />
        </RealtimeProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { calls, client, router };
}
const directory = () =>
  screen.findByRole('list', { name: 'Guests and permitted boards' });

describe('Workspace Guests contract and navigation', () => {
  it('maps the exact #132 envelope and forwards only paging/search with cancellation', async () => {
    const calls = mockApi({
      [`GET ${base}/guests?page=2&limit=10&search=Grace+%25_`]: workspacePage(
        [guest],
        2,
        11,
        10,
      ),
    });
    const controller = new AbortController();
    const page = await listWorkspaceGuests(
      'test-token',
      id,
      { page: 2, limit: 10, search: ' Grace %_ ' },
      controller.signal,
    );
    expect(page).toEqual({ items: [guest], total: 11, page: 2, pageCount: 2 });
    expect(calls).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it('deep-links a distinct Guest with only server-provided Board links, roles and archive markers', async () => {
    const { calls } = mount();
    const list = await directory();
    expect(
      within(list).getAllByRole('heading', { name: 'Grace Guest' }),
    ).toHaveLength(1);
    expect(within(list).getByText('2 permitted boards')).toBeTruthy();
    expect(
      within(list)
        .getByRole('link', { name: 'Design review' })
        .getAttribute('href'),
    ).toBe('/boards/board-a');
    expect(
      within(list)
        .getByRole('link', { name: 'Research archive' })
        .getAttribute('href'),
    ).toBe('/boards/board-b');
    expect(within(list).getByText('Owner')).toBeTruthy();
    expect(within(list).getByText('Member')).toBeTruthy();
    expect(within(list).getByText('Archived · Read-only')).toBeTruthy();
    expect(screen.getByText('1 guest in this directory')).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: 'Guests on boards you can view member details for',
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Other private board guests are not included/),
    ).toBeTruthy();
    expect(
      screen.getByRole('tab', { name: 'Guests' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
      'members-tab-guests',
    );
    expect(within(list).queryByRole('button')).toBeNull();
    expect(calls.some((call) => call.path.startsWith('/boards'))).toBe(false);
    expect(calls.some((call) => call.path.includes('/members?'))).toBe(false);
    expect(calls.some((call) => call.path.includes('/invitations'))).toBe(
      false,
    );
  });

  it('supports three tabs, history and keyboard wrap/Home/End', async () => {
    const { router } = mount();
    await directory();
    const guests = screen.getByRole('tab', { name: 'Guests' });
    fireEvent.click(screen.getByRole('tab', { name: 'Members' }));
    await screen.findByText('No members yet');
    expect(router.state.location.search).toBe('');
    await act(() => router.navigate(-1));
    await directory();
    expect(router.state.location.search).toBe('?tab=guests');
    await act(() => router.navigate(1));
    await screen.findByText('No members yet');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Members' }), {
      key: 'End',
    });
    await directory();
    expect(document.activeElement).toBe(guests);
    fireEvent.keyDown(guests, { key: 'ArrowRight' });
    await screen.findByText('No members yet');
    expect(document.activeElement).toBe(
      screen.getByRole('tab', { name: 'Members' }),
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Members' }), {
      key: 'ArrowLeft',
    });
    await directory();
    fireEvent.keyDown(guests, { key: 'Home' });
    await screen.findByText('No members yet');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Members' }), {
      key: 'ArrowRight',
    });
    await screen.findByText('No invitations yet');
  });

  it('preserves Guests URL filters when opening/closing Invite and restores them through Back', async () => {
    const searchPath = `${path}&q=Grace&page=2`;
    const { router } = mount(searchPath, {
      [`GET ${base}/guests?page=2&limit=10&search=Grace`]: workspacePage(
        [guest],
        2,
        11,
        10,
      ),
    });
    await directory();
    fireEvent.click(screen.getByRole('button', { name: 'Invite Member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite member' });
    expect(new URLSearchParams(router.state.location.search).get('q')).toBe(
      'Grace',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe(
      '2',
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Invitations' }));
    await screen.findByText('No invitations yet');
    expect(router.state.location.search).toBe('?tab=invitations');
    await act(() => router.navigate(-1));
    await directory();
    expect(
      (
        screen.getByRole('searchbox', {
          name: 'Search guests',
        }) as HTMLInputElement
      ).value,
    ).toBe('Grace');
  });
});

describe('Guest search, paging and states', () => {
  it('searches the server, resets pagination and hides prior results during debounce', async () => {
    const { router, calls } = mount(`${path}&page=2`, {
      [`GET ${base}/guests?page=2&limit=10`]: workspacePage([guest], 2, 11, 10),
      [`GET ${base}/guests?page=1&limit=10&search=missing`]: workspacePage(
        [],
        1,
        0,
        10,
      ),
    });
    await directory();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search guests' }), {
      target: { value: 'missing' },
    });
    expect(screen.queryByText('Grace Guest')).toBeNull();
    await screen.findByText('No matching guests in this directory');
    expect(
      screen.getByText('0 guests matching this search in this directory'),
    ).toBeTruthy();
    expect(router.state.location.search).toBe('?tab=guests&q=missing');
    expect(
      calls.some((call) =>
        call.path.includes('/guests?page=1&limit=10&search=missing'),
      ),
    ).toBe(true);
  });

  it('uses server totals, navigates pages and clamps a page after removal', async () => {
    let shrank = false;
    const { client, router } = mount(path, {
      [endpoint]: workspacePage([guest], 1, 11, 10),
      [`GET ${base}/guests?page=2&limit=10`]: () =>
        shrank
          ? workspacePage([], 2, 1, 10)
          : workspacePage(
              [
                {
                  ...guest,
                  user: { ...guest.user, displayName: 'Last Guest' },
                },
              ],
              2,
              11,
              10,
            ),
    });
    await directory();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Last Guest');
    expect(router.state.location.search).toBe('?tab=guests&page=2');
    shrank = true;
    await act(() =>
      client.invalidateQueries({
        queryKey: workspaceKeys.guests(testUser.id, 0, id),
      }),
    );
    await screen.findByText('Grace Guest');
    expect(
      new URLSearchParams(router.state.location.search).get('page'),
    ).toBeNull();
  });

  it.each(['0', '1.5', '1000001', 'Infinity'])(
    'normalizes invalid page %s without sending it',
    async (page) => {
      const { calls } = mount(`${path}&page=${page}`);
      await directory();
      expect(
        calls
          .filter((call) => call.path.includes('/guests?'))
          .map((call) => call.path),
      ).toEqual([`${base}/guests?page=1&limit=10`]);
    },
  );

  it.each(['ADMIN', 'MEMBER'] as const)(
    'shows an honest scoped empty state for %s',
    async (role) => {
      mount(
        path,
        { [endpoint]: workspacePage([], 1, 0, 10) },
        { ...workspace, role, canManage: role === 'ADMIN' },
      );
      await screen.findByText(
        'No guests on boards you can see member details for',
      );
      expect(
        screen.getByText(/Other private boards may have guests/),
      ).toBeTruthy();
      expect(
        screen.queryByRole('list', { name: 'Guests and permitted boards' }),
      ).toBeNull();
    },
  );

  it('renders loading, error/retry and real avatars without showing cached rows on refresh', async () => {
    const pending = deferred<MockResponse>();
    let next: MockResponse | Promise<MockResponse> = pending.promise;
    const { client } = mount(path, { [endpoint]: () => next });
    await screen.findByRole('searchbox', { name: 'Search guests' });
    expect(screen.getByText('Loading workspace')).toBeTruthy();
    await act(async () => pending.resolve(fail(500, 'INTERNAL_ERROR')));
    await screen.findByRole('button', { name: 'Try again' });
    next = workspacePage(
      [
        {
          ...guest,
          user: {
            ...guest.user,
            avatarUrl: 'https://images.example.test/guest.webp',
          },
        },
      ],
      1,
      1,
      10,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    const list = await directory();
    expect(list.querySelector('img')?.getAttribute('src')).toBe(
      'https://images.example.test/guest.webp',
    );
    const refresh = deferred<MockResponse>();
    next = refresh.promise;
    act(() => {
      void client.invalidateQueries({
        queryKey: workspaceKeys.guests(testUser.id, 0, id),
      });
    });
    await waitFor(() => expect(screen.queryByText('Grace Guest')).toBeNull());
    await act(async () => refresh.resolve(workspacePage([], 1, 0, 10)));
    await screen.findByText(
      'No guests on boards you can see member details for',
    );
  });
});

describe('Guest access boundaries and stale responses', () => {
  it.each([403, 404])(
    'clears identities, Board labels, every cached page and the Workspace header on %s',
    async (status) => {
      let denied = false;
      const { client } = mount(path, {
        [endpoint]: () =>
          denied ? fail(status, 'DENIED') : workspacePage([guest], 1, 1, 10),
      });
      await directory();
      denied = true;
      await act(() =>
        client.invalidateQueries({
          queryKey: workspaceKeys.guests(testUser.id, 0, id),
        }),
      );
      await screen.findByText(
        status === 403 ? 'Workspace access unavailable' : 'Workspace not found',
      );
      expect(screen.queryByText('Grace Guest')).toBeNull();
      expect(screen.queryByText('Design review')).toBeNull();
      expect(
        screen.queryByRole('heading', { name: workspace.name }),
      ).toBeNull();
      for (const query of client
        .getQueryCache()
        .findAll({ queryKey: workspaceKeys.resource(testUser.id, 0, id) }))
        expect(query.state.data).toBeNull();
    },
  );

  it('ends the session on 401 and never renders a Guest', async () => {
    mount(path, { [endpoint]: fail(401, 'UNAUTHORIZED') });
    await screen.findByRole('heading', { name: /Welcome back/ });
    expect(screen.queryByText('Grace Guest')).toBeNull();
  });

  it('does not request the directory for a Board-only Guest denied Workspace access', async () => {
    const { calls } = mount(path, {
      [`GET ${base}/overview`]: fail(404, 'NOT_FOUND'),
    });
    await screen.findByText('Workspace not found');
    expect(calls.some((call) => call.path.includes('/guests'))).toBe(false);
  });

  it.each([
    'member:removed',
    'board:access-changed',
    'board:archived',
    'board:restored',
    'access:changed',
  ])(
    'clears old associations immediately and ignores an older request after %s',
    async (event) => {
      const old = deferred<MockResponse>();
      const fresh = deferred<MockResponse>();
      let reads = 0;
      const { client } = mount(path, {
        [endpoint]: () =>
          ++reads === 1
            ? workspacePage([guest], 1, 1, 10)
            : reads === 2
              ? old.promise
              : fresh.promise,
      });
      await directory();
      act(() => {
        void client.invalidateQueries({
          queryKey: workspaceKeys.guests(testUser.id, 0, id),
        });
      });
      await waitFor(() => expect(reads).toBe(2));
      act(() =>
        createdSockets.at(-1)!.socket.push(event, {
          boardId: 'board-a',
          userId: testUser.id,
          retainsReadAccess: true,
        }),
      );
      await waitFor(() => expect(reads).toBeGreaterThanOrEqual(3));
      expect(screen.queryByText('Grace Guest')).toBeNull();
      await act(async () => fresh.resolve(workspacePage([], 1, 0, 10)));
      await screen.findByText(
        'No guests on boards you can see member details for',
      );
      await act(async () => old.resolve(workspacePage([guest], 1, 1, 10)));
      expect(screen.queryByText('Grace Guest')).toBeNull();
      expect(screen.queryByText('Design review')).toBeNull();
    },
  );

  it.each(['workspace:access-revoked', 'board:access-revoked'])(
    'hides a pending protected response after %s',
    async (event) => {
      const old = deferred<MockResponse>();
      const { client } = mount(path, { [endpoint]: () => old.promise });
      await screen.findByRole('searchbox', { name: 'Search guests' });
      await waitFor(() =>
        expect(
          client.isFetching({
            queryKey: workspaceKeys.guests(testUser.id, 0, id),
          }),
        ).toBe(1),
      );
      act(() =>
        createdSockets
          .at(-1)!
          .socket.push(
            event,
            event.startsWith('workspace')
              ? { workspaceId: id }
              : { boardId: 'board-a' },
          ),
      );
      await act(async () => old.resolve(workspacePage([guest], 1, 1, 10)));
      expect(screen.queryByText('Grace Guest')).toBeNull();
    },
  );

  it.each(['new-account', 'same-account', 'logout'])(
    'discards late data on %s session boundary',
    async (change) => {
      const old = deferred<MockResponse>();
      const { client } = mount(path, {
        [endpoint]: (request) =>
          request.headers.Authorization === 'Bearer stored-token'
            ? old.promise
            : workspacePage([], 1, 0, 10),
        'GET /users/me': (request) =>
          ok(
            request.headers.Authorization === 'Bearer newer-token' &&
              change === 'new-account'
              ? { ...testUser, id: 'new-user', displayName: 'New account' }
              : testUser,
          ),
      });
      await screen.findByRole('searchbox', { name: 'Search guests' });
      act(() => {
        if (change === 'logout') localStorage.removeItem('kanban.session');
        else storeSession('newer-token');
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'kanban.session' }),
        );
      });
      if (change === 'logout')
        await screen.findByRole('heading', { name: /Welcome back/ });
      else
        await screen.findByText(
          'No guests on boards you can see member details for',
        );
      await act(async () => old.resolve(workspacePage([guest], 1, 1, 10)));
      expect(screen.queryByText('Grace Guest')).toBeNull();
      expect(
        client
          .getQueryCache()
          .findAll({ queryKey: workspaceKeys.guests(testUser.id, 0, id) }),
      ).toHaveLength(0);
    },
  );

  it('clears all Guest pages while leaving independent Members caches intact', async () => {
    const client = new QueryClient();
    const guests = workspaceKeys.guests('user', 2, id);
    const members = workspaceKeys.members('user', 2, id);
    client.setQueryData([...guests, { page: 1 }], guest);
    client.setQueryData([...guests, { page: 2 }], guest);
    client.setQueryData(members, ['Workspace member']);
    const old = deferred<WorkspaceGuest>();
    const running = client
      .fetchQuery({
        queryKey: [...guests, { page: 1 }],
        queryFn: () => old.promise,
      })
      .catch(() => undefined);
    refreshWorkspaceGuests(client);
    old.resolve(guest);
    await running;
    for (const query of client.getQueryCache().findAll({ queryKey: guests }))
      expect(query.state.data).toBeUndefined();
    expect(client.getQueryData(members)).toEqual(['Workspace member']);
    client.clear();
  });
});
