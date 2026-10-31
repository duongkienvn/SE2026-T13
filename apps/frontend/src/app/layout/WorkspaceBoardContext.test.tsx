import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../routes';
import { AuthProvider } from '../../features/auth/AuthProvider';
import { RealtimeProvider } from '../../features/realtime/RealtimeProvider';
import { receiveWorkspaceRevocation } from '../../features/realtime/access-revocation';
import { boardKeys } from '../../features/boards/query-keys';
import { workspaceKeys } from '../../features/workspaces/query-keys';
import { makeBoard, okPage } from '../../test/board-fixtures';
import { mockApi, ok, storeSession, testUser } from '../../test/mock-api';
import {
  workspaceResponse,
  workspacePage,
} from '../../test/workspace-fixtures';

const workspace = { ...workspaceResponse, name: 'Authorized engineering' };
const destination = {
  ...workspace,
  id: '00000000-0000-4000-8000-000000000116',
  name: 'Authorized design',
};
function mount({
  guest = false,
  role = 'MEMBER',
  visibility = 'PRIVATE',
  path,
  archived = false,
}: {
  guest?: boolean;
  role?: 'OWNER' | 'MEMBER' | null;
  visibility?: 'PRIVATE' | 'WORKSPACE_VISIBLE';
  path?: string;
  archived?: boolean;
} = {}) {
  storeSession();
  let board = makeBoard({
    name: 'Context Board',
    workspaceId: workspace.id,
    visibility,
    currentUserRole: role,
    isArchived: archived,
  });
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    'GET /workspaces?page=1&limit=100': workspacePage(
      guest ? [] : [workspace, destination],
      1,
      guest ? 0 : 2,
      100,
    ),
    'GET /boards?page=1&limit=100': okPage([board]),
    [`GET /boards/${board.id}`]: () => ok(board),
    [`GET /boards/${board.id}/policy-capabilities`]: ok({
      canInviteMembers: true,
      canChangeMembership: true,
      canChangeVisibility: true,
    }),
    ...Object.fromEntries(
      ['columns', 'cards', 'members'].map((resource) => [
        `GET /boards/${board.id}/${resource}?page=1&limit=100`,
        okPage([]),
      ]),
    ),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, {
    initialEntries: [path ?? `/boards/${board.id}`],
  });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RealtimeProvider>
          <RouterProvider router={router} />
        </RealtimeProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return {
    client,
    router,
    calls,
    board,
    move: () => {
      board = { ...board, workspaceId: destination.id, visibility: 'PRIVATE' };
    },
  };
}
const breadcrumb = () =>
  within(screen.getByRole('banner')).getByRole('navigation', {
    name: 'Breadcrumb',
  });

describe('authorized Board Workspace context', () => {
  it.each(['PRIVATE', 'WORKSPACE_VISIBLE'] as const)(
    'discovers the containing Workspace on a direct %s permalink',
    async (visibility) => {
      mount({ visibility });
      const nav = within(
        await screen.findByRole('navigation', { name: 'Breadcrumb' }),
      );
      expect(
        await nav.findByRole('link', { name: workspace.name }),
      ).toBeTruthy();
      expect(
        nav.getByRole('link', { name: 'Boards' }).getAttribute('href'),
      ).toBe(`/workspaces/${workspace.id}/boards`);
      const primary = within(
        await screen.findByRole('navigation', { name: 'Primary' }),
      );
      expect(
        primary
          .getByRole('link', { name: workspace.name })
          .getAttribute('aria-current'),
      ).toBe('location');
      expect(
        primary
          .getByRole('link', { name: 'Boards' })
          .getAttribute('aria-current'),
      ).toBeNull();
      expect(primary.queryByRole('link', { name: 'Overview' })).toBeNull();
    },
  );
  it.each(['OWNER', 'MEMBER', null] as const)(
    'keeps a Board-only %s Guest out of Workspace context',
    async (role) => {
      const { calls } = mount({ guest: true, role });
      await screen.findByRole('heading', { name: 'Context Board' });
      await waitFor(() =>
        expect(breadcrumb().textContent).toBe('BoardsContext Board'),
      );
      expect(
        within(breadcrumb())
          .getByRole('link', { name: 'Boards' })
          .getAttribute('href'),
      ).toBe('/boards');
      expect(screen.queryByText(workspace.name)).toBeNull();
      expect(
        calls.some((call) =>
          call.path.startsWith(`/workspaces/${workspace.id}`),
        ),
      ).toBe(false);
      if (role === null)
        expect(
          within(screen.getByRole('main')).queryByRole('link', {
            name: 'Members',
          }),
        ).toBeNull();
    },
  );
  it('uses the same authorized destination from Global Boards and preserves Back/Forward', async () => {
    const { router } = mount({ path: '/boards' });
    const primary = within(
      await screen.findByRole('navigation', { name: 'Primary' }),
    );
    expect(
      primary
        .getByRole('link', { name: 'Boards' })
        .getAttribute('aria-current'),
    ).toBe('page');
    fireEvent.click(await screen.findByRole('link', { name: 'Context Board' }));
    await within(
      await screen.findByRole('navigation', { name: 'Breadcrumb' }),
    ).findByRole('link', { name: workspace.name });
    await act(() => router.navigate(-1));
    expect(
      primary
        .getByRole('link', { name: 'Boards' })
        .getAttribute('aria-current'),
    ).toBe('page');
    await act(() => router.navigate(1));
    await within(
      await screen.findByRole('navigation', { name: 'Breadcrumb' }),
    ).findByRole('link', { name: workspace.name });
  });
  it('uses a moved Board’s current Workspace, including an archived Board', async () => {
    const { client, board, move } = mount({ archived: true });
    await within(
      await screen.findByRole('navigation', { name: 'Breadcrumb' }),
    ).findByRole('link', { name: workspace.name });
    move();
    await act(() =>
      client.invalidateQueries({ queryKey: boardKeys.detail(board.id) }),
    );
    await within(breadcrumb()).findByRole('link', { name: destination.name });
    expect(
      within(breadcrumb()).queryByRole('link', { name: workspace.name }),
    ).toBeNull();
    expect(
      within(breadcrumb())
        .getByRole('link', { name: 'Boards' })
        .getAttribute('href'),
    ).toBe(`/workspaces/${destination.id}/boards`);
  });
  it('drops only Workspace identity on revocation while preserving an explicit Board grant', async () => {
    const { client } = mount();
    await within(
      await screen.findByRole('navigation', { name: 'Breadcrumb' }),
    ).findByRole('link', { name: workspace.name });
    await act(async () =>
      receiveWorkspaceRevocation(client, { workspaceId: workspace.id }),
    );
    await waitFor(() =>
      expect(
        within(breadcrumb()).queryByRole('link', { name: workspace.name }),
      ).toBeNull(),
    );
    expect(
      within(breadcrumb())
        .getByRole('link', { name: 'Boards' })
        .getAttribute('href'),
    ).toBe('/boards');
    expect(screen.getByRole('heading', { name: 'Context Board' })).toBeTruthy();
    expect(
      JSON.stringify(client.getQueryData(workspaceKeys.list(testUser.id, 0))),
    ).not.toContain(workspace.name);
  });
});
