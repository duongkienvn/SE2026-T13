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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import { ApiError } from '../../lib/api-client';
import { mockApi, ok, storeSession, testUser } from '../../test/mock-api';
import { AuthProvider } from '../auth/AuthProvider';
import { workspaceGateway, type WorkspaceGateway } from './api';
import { WorkspaceGatewayContext } from './gateway-context';
import { workspaceKeys } from './query-keys';
import type { WorkspaceOverview, WorkspaceSummary } from './types';

const team: WorkspaceSummary = {
  id: 'team-one',
  name: 'Engineering space',
  description: 'Build together.',
  type: 'TEAM',
  role: 'ADMIN',
  canCreateBoards: true,
};
const personal: WorkspaceSummary = {
  ...team,
  id: 'personal-one',
  name: 'My personal space',
  type: 'PERSONAL',
};
const overview: WorkspaceOverview = {
  workspace: team,
  visibleBoardCount: 7,
  memberCount: null,
  recentBoards: [
    {
      id: 'visible-board',
      name: 'Allowed board',
      updatedAt: '2026-10-27T09:00:00Z',
      archived: true,
      memberCount: null,
    },
  ],
};

function makeGateway(
  overrides: Partial<WorkspaceGateway> = {},
): WorkspaceGateway {
  return {
    available: true,
    list: vi.fn(async () => [personal, team]),
    overview: vi.fn(async (_token, id) => ({
      ...overview,
      workspace: id === personal.id ? personal : team,
    })),
    createTeam: vi.fn(async () => ({
      ...team,
      id: 'new-team',
      name: 'New team',
    })),
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function mount(path: string, gateway: WorkspaceGateway = makeGateway()) {
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    'POST /auth/logout': ok(undefined),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <WorkspaceGatewayContext.Provider value={gateway}>
          <RouterProvider router={router} />
        </WorkspaceGatewayContext.Provider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, calls, client, router, gateway };
}
async function loaded() {
  return screen.findByRole('heading', { level: 1, name: team.name });
}
function main() {
  return within(screen.getByRole('main'));
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem('kanvexa.sidebar.expanded');
});

describe('Workspace runtime and navigation', () => {
  it.each(['ADMIN', 'MEMBER'] as const)(
    'shows numeric Workspace and recent Board counts for %s',
    async (role) => {
      mount(
        `/workspaces/${team.id}`,
        makeGateway({
          overview: async () => ({
            ...overview,
            workspace: { ...team, role },
            memberCount: 5,
            recentBoards: [{ ...overview.recentBoards[0], memberCount: 1 }],
          }),
        }),
      );
      await loaded();
      expect(main().getByText('5 members')).toBeTruthy();
      expect(main().getByText('1 member')).toBeTruthy();
      const summary = main().getByRole('region', { name: 'Workspace summary' });
      expect(within(summary).getByText('5')).toBeTruthy();
    },
  );
  it.each([0, 1])(
    'keeps Workspace member count %s numeric and correctly pluralized',
    async (memberCount) => {
      mount(
        `/workspaces/${team.id}`,
        makeGateway({ overview: async () => ({ ...overview, memberCount }) }),
      );
      await loaded();
      expect(
        main().getByText(
          `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`,
        ),
      ).toBeTruthy();
      expect(main().getByText('Board member count private')).toBeTruthy();
    },
  );
  it('renders the entire unavailable composition without calling a speculative API', async () => {
    const { calls } = mount('/workspaces/unknown', {
      ...workspaceGateway,
      available: false,
    });
    await screen.findByRole('heading', { name: 'Workspaces are on their way' });
    expect(
      main().getByRole('region', { name: 'Workspace summary' }),
    ).toBeTruthy();
    expect(main().getByRole('region', { name: 'Recent Boards' })).toBeTruthy();
    expect(main().getByRole('region', { name: 'Activity' })).toBeTruthy();
    const nav = main().getByRole('navigation', { name: 'Workspace sections' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((item) => item.textContent),
    ).toEqual(['Overview', 'Boards', 'Members', 'Settings']);
    expect(within(nav).queryAllByText(/coming soon/)).toHaveLength(0);
    expect(calls.some((call) => /workspaces|boards/.test(call.path))).toBe(
      false,
    );
    expect(
      main().getByRole('region', { name: 'Workspace summary' }).textContent,
    ).not.toMatch(/\b0\b/);
  });

  it('shows membership-only personal/team discovery and the real creation entry', async () => {
    mount('/workspaces');
    await screen.findByRole('main');
    expect(
      await main().findByRole('heading', { name: team.name }),
    ).toBeTruthy();
    expect(main().getByRole('heading', { name: personal.name })).toBeTruthy();
    expect(
      main()
        .getByRole('link', { name: new RegExp(team.name) })
        .getAttribute('href'),
    ).toBe('/workspaces/team-one');
    fireEvent.click(main().getByRole('button', { name: 'Create Workspace' }));
    expect(
      await screen.findByRole('dialog', { name: 'Create a team workspace' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /Create Personal/i }),
    ).toBeNull();
  });

  it('uses backend-filtered metrics without deriving totals or members from board data', async () => {
    mount(`/workspaces/${team.id}`);
    await loaded();
    const summary = main().getByRole('region', { name: 'Workspace summary' });
    expect(summary.textContent).toContain('7');
    expect(
      within(summary)
        .getAllByRole('term')
        .map((item) => item.textContent),
    ).toEqual(['Visible boards', 'Members']);
    expect(main().queryByText('Active this week')).toBeNull();
    expect(main().queryByText('Total cards')).toBeNull();
    expect(
      within(summary)
        .getAllByRole('definition')
        .filter((item) => item.textContent?.includes('Unavailable')),
    ).toHaveLength(1);
    expect(
      main()
        .getByRole('link', { name: /Allowed board/ })
        .getAttribute('href'),
    ).toBe('/boards/visible-board');
    expect(main().getByText(/Archived · Read only/)).toBeTruthy();
    expect(main().getByText('Member summary unavailable')).toBeTruthy();
  });

  it('supports direct routes, breadcrumbs, switching, Back and Forward', async () => {
    const { router } = mount(`/workspaces/${team.id}`);
    await loaded();
    const crumbs = main().getByRole('navigation', {
      name: 'Workspace breadcrumb',
    });
    expect(crumbs.textContent).toBe(`Workspaces${team.name}Overview`);
    expect(
      within(crumbs).getByText('Overview').getAttribute('aria-current'),
    ).toBe('page');
    const sections = main().getByRole('navigation', {
      name: 'Workspace sections',
    });
    expect(
      within(sections)
        .getByRole('link', { name: 'Overview' })
        .getAttribute('aria-current'),
    ).toBe('page');
    fireEvent.click(screen.getByRole('link', { name: personal.name }));
    await main().findByRole('heading', { level: 1, name: personal.name });
    expect(
      main().queryByRole('heading', { level: 1, name: team.name }),
    ).toBeNull();
    await act(() => router.navigate(-1));
    await loaded();
    await act(() => router.navigate(1));
    await main().findByRole('heading', { level: 1, name: personal.name });
  });

  it('uses Overview destinations from Sidebar even on a nested Settings route, with no section links duplicated', async () => {
    mount(`/workspaces/${team.id}/settings/general`);
    await loaded();
    const primary = within(screen.getByRole('navigation', { name: 'Primary' }));
    expect(
      primary.getByRole('link', { name: personal.name }).getAttribute('href'),
    ).toBe(`/workspaces/${personal.id}`);
    expect(
      primary
        .getByRole('link', { name: team.name })
        .getAttribute('aria-current'),
    ).toBe('location');
    for (const section of ['Overview', 'Members', 'Settings'])
      expect(primary.queryByRole('link', { name: section })).toBeNull();
    expect(
      primary.getByRole('link', { name: 'Boards' }).getAttribute('href'),
    ).toBe('/boards');
  });

  it('keeps a keyboard-accessible selector with current indication and Escape restoration', async () => {
    mount(`/workspaces/${team.id}`);
    await loaded();
    const summary = screen.getByLabelText(`Switch workspace, ${team.name}`);
    const details = summary.closest('details')!;
    fireEvent.click(summary);
    details.open = true;
    expect(
      within(details)
        .getByRole('link', { name: `${team.name} Team` })
        .getAttribute('aria-current'),
    ).toBe('location');
    const link = within(details).getByRole('link', {
      name: `${personal.name} Personal`,
    });
    link.focus();
    fireEvent.keyDown(link, { key: 'Escape' });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    fireEvent.click(summary);
    details.open = true;
    fireEvent.click(link);
    await main().findByRole('heading', { level: 1, name: personal.name });
    expect(details.open).toBe(false);
  });

  it('keeps the workspace group independently collapsible', async () => {
    mount(`/workspaces/${team.id}`);
    await loaded();
    const group = screen.getByRole('button', { name: 'Workspaces' });
    fireEvent.click(group);
    expect(group.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: personal.name })).toBeNull();
    fireEvent.click(group);
    expect(group.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: personal.name })).toBeTruthy();
  });

  it('keeps the compact rail selector on a real discovery destination', async () => {
    mount(`/workspaces/${team.id}`);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(
      screen
        .getByRole('link', { name: 'Choose workspace' })
        .getAttribute('href'),
    ).toBe('/workspaces');
  });

  it('does not invent downstream page routes', async () => {
    mount(`/workspaces/${team.id}/activity`);
    expect(
      await screen.findByRole('heading', { name: /not found/i }),
    ).toBeTruthy();
  });

  it('uses the existing mobile drawer, traps focus and opens creation without nested dialogs', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    mount(`/workspaces/${team.id}`);
    await loaded();
    const opener = screen.getByRole('button', { name: 'Open navigation' });
    opener.focus();
    fireEvent.click(opener);
    const drawer = await screen.findByRole('dialog', {
      name: 'Navigation menu',
    });
    const logout = within(drawer).getByRole('button', { name: 'Log out' });
    logout.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(
      within(drawer).getByRole('link', { name: 'Kanvexa landing page' }),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    fireEvent.click(
      within(screen.getByRole('dialog'))
        .getAllByRole('link', {
          name: 'Create Workspace',
        })
        .at(-1)!,
    );
    await screen.findByRole('dialog', { name: 'Create a team workspace' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(document.activeElement).toBe(
      screen.getByLabelText('Workspace name'),
    );
  });
});

describe('Workspace states and access isolation', () => {
  it('distinguishes no memberships and no accessible boards from an unavailable API', async () => {
    const { router, gateway } = mount(
      '/workspaces',
      makeGateway({ list: vi.fn(async () => []) }),
    );
    await screen.findByRole('heading', { name: 'No workspaces available' });
    gateway.overview = vi.fn(async () => ({
      ...overview,
      visibleBoardCount: 0,
      recentBoards: [],
    }));
    await act(() => router.navigate(`/workspaces/${team.id}`));
    await loaded();
    expect(
      main().getByRole('heading', { name: 'No accessible boards yet' }),
    ).toBeTruthy();
    expect(
      main().getByRole('region', { name: 'Workspace summary' }).textContent,
    ).toContain('0');
  });

  it('keeps skeleton composition while loading and cancels when switching workspace', async () => {
    const pending = deferred<WorkspaceOverview>();
    let signal: AbortSignal | undefined;
    const gateway = makeGateway({
      overview: vi.fn((_token, id, currentSignal) => {
        if (id === team.id) {
          signal = currentSignal;
          return pending.promise;
        }
        return Promise.resolve({ ...overview, workspace: personal });
      }),
    });
    const { router } = mount(`/workspaces/${team.id}`, gateway);
    await screen.findByText('Loading workspace');
    await waitFor(() => expect(signal).toBeDefined());
    expect(main().getByLabelText('Loading recent boards')).toBeTruthy();
    await act(() => router.navigate(`/workspaces/${personal.id}`));
    await main().findByRole('heading', { level: 1, name: personal.name });
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      pending.resolve({
        ...overview,
        memberCount: 77,
        recentBoards: [{ ...overview.recentBoards[0], memberCount: 99 }],
      }),
    );
    expect(
      main().queryByRole('heading', { level: 1, name: team.name }),
    ).toBeNull();
  });

  it.each([403, 404])(
    'hides and evicts protected data on a %s background refresh',
    async (status) => {
      const gateway = makeGateway();
      const { client } = mount(`/workspaces/${team.id}`, gateway);
      await loaded();
      gateway.overview = vi.fn(async () => {
        throw new ApiError(
          status,
          'DENIED',
          'Do not echo confidential error text',
        );
      });
      await act(async () => {
        await client.invalidateQueries({
          queryKey: workspaceKeys.overview(testUser.id, 0, team.id),
        });
      });
      await screen.findByRole('heading', {
        name:
          status === 403
            ? 'Workspace access unavailable'
            : 'Workspace not found',
      });
      expect(screen.queryByText(team.name)).toBeNull();
      expect(screen.queryByText('Allowed board')).toBeNull();
      expect(document.body.textContent).not.toContain(
        'confidential error text',
      );
      expect(
        JSON.stringify(
          client.getQueryData(workspaceKeys.overview(testUser.id, 0, team.id)),
        ),
      ).not.toContain('Allowed board');
      expect(
        JSON.stringify(client.getQueryData(workspaceKeys.list(testUser.id, 0))),
      ).not.toContain(team.name);
    },
  );

  it('shows a safe network error and reloads on retry', async () => {
    const getOverview = vi
      .fn<WorkspaceGateway['overview']>()
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'))
      .mockResolvedValue(overview);
    mount(`/workspaces/${team.id}`, makeGateway({ overview: getOverview }));
    await screen.findByRole('heading', { name: 'Could not load workspace' });
    fireEvent.click(main().getByRole('button', { name: 'Try again' }));
    await loaded();
    expect(getOverview).toHaveBeenCalledTimes(2);
  });

  it('retries discovery after a failure without retaining old directory rows', async () => {
    const list = vi
      .fn<WorkspaceGateway['list']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([team]);
    mount('/workspaces', makeGateway({ list }));
    await screen.findByRole('heading', { name: 'Could not load workspace' });
    fireEvent.click(main().getByRole('button', { name: 'Try again' }));
    await main().findByRole('heading', { name: team.name });
  });

  it('ends the session on 401 without exposing an old workspace', async () => {
    const { router } = mount(
      `/workspaces/${team.id}`,
      makeGateway({
        overview: vi.fn(async () => {
          throw new ApiError(401, 'UNAUTHORIZED', 'Expired');
        }),
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(screen.queryByText(team.name)).toBeNull();
    expect(localStorage.getItem('kanban.session')).toBeNull();
  });

  it('clears cached workspaces and ignores an in-flight response when accounts switch', async () => {
    const pending = deferred<WorkspaceOverview>();
    const gateway = makeGateway({
      list: vi.fn(async (token) => (token === 'stored-token' ? [team] : [])),
      overview: vi.fn((token) =>
        token === 'stored-token'
          ? pending.promise
          : Promise.reject(new ApiError(403, 'FORBIDDEN', 'Unavailable')),
      ),
    });
    const { client } = mount(`/workspaces/${team.id}`, gateway);
    await waitFor(() => expect(gateway.overview).toHaveBeenCalled());
    mockApi({
      'GET /users/me': ok({
        ...testUser,
        id: 'other-user',
        displayName: 'Other account',
      }),
    });
    await act(async () => {
      storeSession('other-session');
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'kanban.session' }),
      );
    });
    await screen.findByRole('heading', {
      name: 'Workspace access unavailable',
    });
    await act(async () => pending.resolve(overview));
    expect(document.body.textContent).not.toContain(team.name);
    expect(document.body.textContent).not.toContain('Allowed board');
    expect(document.body.textContent).not.toContain('77 members');
    expect(document.body.textContent).not.toContain('99 members');
    expect(
      client.getQueryData(workspaceKeys.list(testUser.id, 0)),
    ).toBeUndefined();
  });

  it('clears private data on cross-tab logout', async () => {
    const { client, router } = mount(
      `/workspaces/${team.id}`,
      makeGateway({
        overview: async () => ({
          ...overview,
          memberCount: 77,
          recentBoards: [{ ...overview.recentBoards[0], memberCount: 99 }],
        }),
      }),
    );
    await loaded();
    await screen.findByText('77 members');
    await act(async () => {
      localStorage.removeItem('kanban.session');
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'kanban.session' }),
      );
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(document.body.textContent).not.toContain(team.name);
    expect(document.body.textContent).not.toContain('77 members');
    expect(document.body.textContent).not.toContain('99 members');
    expect(
      client.getQueryData(workspaceKeys.overview(testUser.id, 0, team.id)),
    ).toBeUndefined();
  });
});

describe('Create team workspace dialog', () => {
  it('validates an unavailable form, prevents saving and restores focus on Escape', async () => {
    const { calls } = mount('/workspaces', {
      ...workspaceGateway,
      available: false,
    });
    const opener = await screen.findByRole('button', {
      name: 'Create Workspace',
    });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText('Workspace name');
    expect(document.activeElement).toBe(input);
    fireEvent.blur(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const save = within(dialog).getByRole('button', {
      name: 'Create unavailable',
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.submit(dialog.querySelector('form')!);
    expect(calls.some((call) => call.path.includes('workspaces'))).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('trims input, prevents duplicate submissions and navigates only after confirmed creation', async () => {
    const pending = deferred<WorkspaceSummary>();
    const createTeam = vi.fn(() => pending.promise);
    const { router } = mount(
      '/workspaces?create=team',
      makeGateway({ createTeam }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Workspace name'), {
      target: { value: '  New team  ' },
    });
    fireEvent.change(within(dialog).getByLabelText('Description (optional)'), {
      target: { value: '  New work  ' },
    });
    const form = dialog.querySelector('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(createTeam).toHaveBeenCalledTimes(1));
    expect(createTeam).toHaveBeenCalledWith('stored-token', {
      name: 'New team',
      description: 'New work',
    });
    expect(router.state.location.pathname).toBe('/workspaces');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () =>
      pending.resolve({ ...team, id: 'new-team', name: 'New team' }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/workspaces/new-team'),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('retains a draft and safely retries after creation fails', async () => {
    const createTeam = vi
      .fn<WorkspaceGateway['createTeam']>()
      .mockRejectedValueOnce(new Error('private backend internals'))
      .mockResolvedValue({ ...team, id: 'new-team' });
    mount('/workspaces?create=team', makeGateway({ createTeam }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Workspace name'), {
      target: { value: 'New team' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create Workspace' }),
    );
    await within(dialog).findByRole('alert');
    expect(
      (within(dialog).getByLabelText('Workspace name') as HTMLInputElement)
        .value,
    ).toBe('New team');
    expect(dialog.textContent).not.toContain('backend internals');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create Workspace' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('ignores a creation result after logout, without redirecting into the old session', async () => {
    const pending = deferred<WorkspaceSummary>();
    const { router } = mount(
      '/workspaces?create=team',
      makeGateway({ createTeam: () => pending.promise }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Workspace name'), {
      target: { value: 'New team' },
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
    await act(async () => pending.resolve({ ...team, id: 'new-team' }));
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not navigate away from a newer route when a closed form request finishes', async () => {
    const pending = deferred<WorkspaceSummary>();
    const { router } = mount(
      '/workspaces?create=team',
      makeGateway({ createTeam: () => pending.promise }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.submit(dialog.querySelector('form')!);
    expect(
      within(dialog)
        .getByLabelText('Workspace name')
        .getAttribute('aria-invalid'),
    ).toBe('true');
    expect(document.activeElement).toBe(
      within(dialog).getByLabelText('Workspace name'),
    );
    fireEvent.change(within(dialog).getByLabelText('Workspace name'), {
      target: { value: 'New team' },
    });
    fireEvent.submit(dialog.querySelector('form')!);
    await within(dialog).findByRole('button', { name: 'Creating…' });
    await act(() => router.navigate(`/workspaces/${personal.id}`));
    await main().findByRole('heading', { level: 1, name: personal.name });
    await act(async () => pending.resolve({ ...team, id: 'new-team' }));
    expect(router.state.location.pathname).toBe(`/workspaces/${personal.id}`);
  });
});
