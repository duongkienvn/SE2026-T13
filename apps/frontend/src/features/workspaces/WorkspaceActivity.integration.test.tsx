import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { receiveWorkspaceRevocation } from '../realtime/access-revocation';
import {
  mockApi,
  ok,
  fail,
  storeSession,
  testUser,
  type MockResponse,
} from '../../test/mock-api';
import { workspacePage } from '../../test/workspace-fixtures';
import { workspaceKeys } from './query-keys';
import { WorkspaceActivity } from './components/WorkspaceActivity';

const event = (name: string) => ({
  id: name,
  eventType: 'WORKSPACE_UPDATED',
  createdAt: '2026-01-01T00:00:00Z',
  actor: { id: 'u', displayName: name, avatarUrl: null },
  board: null,
});
const path = (id: string, page = 1, limit = 5) =>
  `GET /workspaces/${id}/activity?page=${page}&limit=${limit}`;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup(handlers: Parameters<typeof mockApi>[0]) {
  storeSession();
  const calls = mockApi({ 'GET /users/me': ok(testUser), ...handlers });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: '/workspaces/:workspaceId',
        element: <WorkspaceActivity state="ready" />,
      },
    ],
    { initialEntries: ['/workspaces/one'] },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { client, router, calls, ...view };
}
afterEach(() => {
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});
describe('Workspace activity authorization and session', () => {
  it('keeps the five server rows in order and does not invent a board link', async () => {
    const rows = ['First', 'Second', 'Third', 'Fourth', 'Fifth'].map(event);
    setup({ [path('one')]: workspacePage(rows, 1, 23, 5) });
    await screen.findByText('First');
    const region = within(screen.getByRole('region', { name: 'Activity' }));
    const items = region.getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(
      items.map(
        (item) =>
          within(item).getByText(/First|Second|Third|Fourth|Fifth/).textContent,
      ),
    ).toEqual(['First', 'Second', 'Third', 'Fourth', 'Fifth']);
    expect(region.queryByRole('link')).toBeNull();
    expect(items[0].querySelector('time')?.getAttribute('datetime')).toBe(
      rows[0].createdAt,
    );
  });
  it('cancels the old workspace request, removes its pages and ignores a late response', async () => {
    const pending = deferred<MockResponse>();
    const { router, client } = setup({
      [path('one')]: () => pending.promise,
      [path('two')]: workspacePage([event('New workspace')], 1, 1, 5),
    });
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([url]) =>
            String(url).includes('/workspaces/one/activity'),
          ),
      ).toBe(true),
    );
    const oldCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) =>
        String(url).includes('/workspaces/one/activity'),
      )!;
    await act(() => router.navigate('/workspaces/two'));
    expect(await screen.findByText('New workspace')).toBeTruthy();
    expect((oldCall[1]?.signal as AbortSignal).aborted).toBe(true);
    await act(async () =>
      pending.resolve(workspacePage([event('Old private name')], 1, 1, 5)),
    );
    expect(screen.queryByText('Old private name')).toBeNull();
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .findAll({ queryKey: workspaceKeys.activity(testUser.id, 0, 'one') }),
      ).toHaveLength(0),
    );
  });
  it.each([403, 404])(
    'hides previously visible rows when refresh returns %s',
    async (status) => {
      let denied = false;
      const { client } = setup({
        [path('one')]: () =>
          denied
            ? fail(status, 'NOT_FOUND')
            : workspacePage([event('Sensitive row')], 1, 1, 5),
      });
      expect(await screen.findByText('Sensitive row')).toBeTruthy();
      denied = true;
      await act(async () => {
        await client.invalidateQueries({
          queryKey: workspaceKeys.activity(testUser.id, 0, 'one'),
        });
      });
      await waitFor(() =>
        expect(screen.queryByText('Sensitive row')).toBeNull(),
      );
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(
        client.getQueryData([
          ...workspaceKeys.activity(testUser.id, 0, 'one'),
          1,
          5,
        ]),
      ).toBeNull();
    },
  );
  it('clears existing activity on realtime access revocation', async () => {
    const { client } = setup({
      [path('one')]: workspacePage([event('Restricted row')], 1, 1, 5),
    });
    await screen.findByText('Restricted row');
    act(() => receiveWorkspaceRevocation(client, { workspaceId: 'one' }));
    await waitFor(() =>
      expect(screen.queryByText('Restricted row')).toBeNull(),
    );
  });
  it('removes old session activity and ignores an old response after account change', async () => {
    const pending = deferred<MockResponse>();
    let requestCount = 0;
    const { client } = setup({
      [path('one')]: () =>
        ++requestCount === 1
          ? pending.promise
          : workspacePage([event('New account')], 1, 1, 5),
    });
    await waitFor(() => expect(requestCount).toBe(1));
    const oldCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).includes('/activity'))!;
    act(() => {
      storeSession('another-account-token');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'kanban.session',
          storageArea: localStorage,
        }),
      );
    });
    expect(await screen.findByText('New account')).toBeTruthy();
    expect((oldCall[1]?.signal as AbortSignal).aborted).toBe(true);
    await act(async () =>
      pending.resolve(workspacePage([event('Previous account')], 1, 1, 5)),
    );
    expect(screen.queryByText('Previous account')).toBeNull();
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: workspaceKeys.activity(testUser.id, 0, 'one') }),
    ).toHaveLength(0);
  });
  it('ends the current session on an activity 401 and removes its pages', async () => {
    let unauthorized = false;
    const { client } = setup({
      [path('one')]: () =>
        unauthorized
          ? fail(401, 'UNAUTHORIZED')
          : workspacePage([event('Session private row')], 1, 1, 5),
    });
    await screen.findByText('Session private row');
    unauthorized = true;
    await act(async () => {
      await client.invalidateQueries({
        queryKey: workspaceKeys.activity(testUser.id, 0, 'one'),
      });
    });
    await waitFor(() =>
      expect(screen.queryByText('Session private row')).toBeNull(),
    );
    expect(localStorage.getItem('kanban.session')).toBeNull();
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: workspaceKeys.activity(testUser.id, 0, 'one') }),
    ).toHaveLength(0);
  });
  it('refetches on focus and reconnect and hides old data while fetching', async () => {
    let count = 0;
    const { calls } = setup({
      [path('one')]: () =>
        workspacePage([event(`Version ${++count}`)], 1, 1, 5),
    });
    await screen.findByText('Version 1');
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await screen.findByText('Version 2');
    act(() => {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await screen.findByText('Version 3');
    expect(
      calls.filter((call) => call.path.includes('/activity')),
    ).toHaveLength(3);
  });
  it('restores focus even when summary is refreshing while the dialog closes', async () => {
    const pending = deferred<MockResponse>();
    let refreshed = false;
    const { client } = setup({
      [path('one')]: () =>
        refreshed
          ? pending.promise
          : workspacePage([event('Visible')], 1, 1, 5),
      [path('one', 1, 20)]: workspacePage([event('Visible')], 1, 1, 20),
    });
    await screen.findByText('Visible');
    const trigger = screen.getByRole('button', { name: /view all/i });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeTruthy();
    refreshed = true;
    act(() => {
      void client.invalidateQueries({
        queryKey: [...workspaceKeys.activity(testUser.id, 0, 'one'), 1, 5],
      });
    });
    await waitFor(() =>
      expect(trigger.getAttribute('aria-disabled')).toBe('true'),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () =>
      pending.resolve(workspacePage([event('Visible')], 1, 1, 5)),
    );
    expect(
      await within(screen.getByRole('region', { name: 'Activity' })).findByText(
        'Visible',
      ),
    ).toBeTruthy();
  });
});
