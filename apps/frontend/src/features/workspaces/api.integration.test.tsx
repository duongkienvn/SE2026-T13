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
import { describe, expect, it } from 'vitest';
import { routes } from '../../app/routes';
import {
  mockApi,
  ok,
  fail,
  storeSession,
  testUser,
  type MockResponse,
} from '../../test/mock-api';
import {
  workspaceResponse as workspace,
  workspaceBoardResponse as board,
  workspaceOverviewResponse as overview,
  workspacePage,
} from '../../test/workspace-fixtures';
import { AuthProvider } from '../auth/AuthProvider';
import { RealtimeProvider } from '../realtime/RealtimeProvider';
import { workspaceKeys } from './query-keys';

function mount(
  path = `/workspaces/${workspace.id}/boards`,
  overrides: Parameters<typeof mockApi>[0] = {},
) {
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    'GET /workspaces?page=1&limit=100': workspacePage([workspace], 1, 1, 100),
    [`GET /workspaces/${workspace.id}/overview`]: ok(overview),
    [`GET /workspaces/${workspace.id}/boards?page=1&limit=20&status=active&sort=updatedAt`]:
      workspacePage([board]),
    [`GET /boards/${board.id}`]: ok(board),
    ...Object.fromEntries(
      ['cards', 'columns', 'members'].map((resource) => [
        `GET /boards/${board.id}/${resource}?page=1&limit=100`,
        workspacePage([], 1, 0, 100),
      ]),
    ),
    ...overrides,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
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

describe('Workspace routes using production HTTP adapters', () => {
  it('discovers a Workspace, creates a Team and opens its confirmed Overview', async () => {
    const { calls, router } = mount('/workspaces', {
      'POST /workspaces': ok(workspace, 201),
    });
    await screen.findByRole('heading', { name: workspace.name });
    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Workspace name'), {
      target: { value: '  New Team  ' },
    });
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/workspaces/${workspace.id}`,
      ),
    );
    await screen.findByRole('heading', { level: 1, name: workspace.name });
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      name: 'New Team',
      description: '',
    });
    expect(screen.getByText('Member summary unavailable')).toBeTruthy();
  });

  it('creates a Board as a Workspace MEMBER and navigates to the existing Board route', async () => {
    const { calls, router } = mount(undefined, {
      'POST /boards': ok(board, 201),
    });
    await screen.findByRole('link', { name: `Open ${board.name}` });
    fireEvent.click(screen.getByRole('button', { name: 'Create Board' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Board name'), {
      target: { value: 'Sprint' },
    });
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/boards/${board.id}`),
    );
    await screen.findByRole('heading', { name: board.name });
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      name: 'Sprint',
      description: null,
      workspaceId: workspace.id,
    });
  });

  it('archives and restores through existing APIs, refreshing Workspace counts and status pages', async () => {
    let archived = false;
    const { calls } = mount(undefined, {
      [`POST /boards/${board.id}/archive`]: () => {
        archived = true;
        return ok({ ...board, isArchived: true });
      },
      [`POST /boards/${board.id}/restore`]: () => {
        archived = false;
        return ok(board);
      },
      [`GET /workspaces/${workspace.id}/overview`]: () =>
        ok({ ...overview, archivedBoardCount: archived ? 1 : 0 }),
      [`GET /workspaces/${workspace.id}/boards?page=1&limit=20&status=active&sort=updatedAt`]:
        () => workspacePage(archived ? [] : [board]),
      [`GET /workspaces/${workspace.id}/boards?page=1&limit=20&status=archived&sort=updatedAt`]:
        () =>
          workspacePage(
            archived ? [{ ...board, isArchived: true, canEdit: false }] : [],
          ),
    });
    await screen.findByRole('link', { name: `Open ${board.name}` });
    fireEvent.click(
      screen.getByRole('button', { name: `Actions for ${board.name}` }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive board' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Archive board',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: `Open ${board.name}` }),
      ).toBeNull(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    await screen.findByRole('link', {
      name: `Open ${board.name}, archived and read only`,
    });
    fireEvent.click(
      screen.getByRole('button', { name: `Actions for ${board.name}` }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restore board' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Restore board',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      calls.filter((call) => call.path.endsWith('/overview')).length,
    ).toBeGreaterThanOrEqual(3);
    expect(archived).toBe(false);
  });

  it('evicts every protected page when the actual adapter receives a Workspace 404', async () => {
    let response: MockResponse = ok(overview);
    const { client } = mount(undefined, {
      [`GET /workspaces/${workspace.id}/overview`]: () => response,
    });
    await screen.findByRole('link', { name: `Open ${board.name}` });
    response = fail(404, 'NOT_FOUND', 'Workspace not found');
    await act(async () => {
      await client.invalidateQueries({
        queryKey: workspaceKeys.overview(testUser.id, 0, workspace.id),
      });
    });
    await screen.findByRole('heading', { name: 'Workspace not found' });
    expect(screen.queryByText(board.name)).toBeNull();
    expect(screen.queryByText(workspace.name)).toBeNull();
    expect(
      JSON.stringify(client.getQueryData(workspaceKeys.list(testUser.id, 0))),
    ).not.toContain(workspace.name);
    for (const query of client.getQueryCache().findAll({
      queryKey: workspaceKeys.resource(testUser.id, 0, workspace.id),
    }))
      expect(query.state.data).toBeNull();
  });

  it.each([403, 404])(
    'rechecks permissions after Board creation receives %s, without retrying the POST',
    async (status) => {
      let denied = false;
      const { calls } = mount(undefined, {
        'POST /boards': () => {
          denied = true;
          return fail(status, 'DENIED');
        },
        [`GET /workspaces/${workspace.id}/overview`]: () =>
          ok({
            ...overview,
            workspace: { ...workspace, canCreateBoards: !denied },
          }),
      });
      await screen.findByRole('link', { name: `Open ${board.name}` });
      fireEvent.click(screen.getByRole('button', { name: 'Create Board' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Board name'), {
        target: { value: 'Retained draft' },
      });
      fireEvent.submit(dialog.querySelector('form')!);
      if (status === 404) {
        await screen.findByRole('heading', { name: 'Workspace not found' });
        expect(screen.queryByText(board.name)).toBeNull();
        expect(screen.queryByRole('dialog')).toBeNull();
      } else {
        await within(dialog).findByRole('button', {
          name: 'Create unavailable',
        });
        expect(
          (within(dialog).getByLabelText('Board name') as HTMLInputElement)
            .value,
        ).toBe('Retained draft');
        expect(
          (
            within(dialog).getByRole('button', {
              name: 'Create unavailable',
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(true);
      }
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    },
  );
});
