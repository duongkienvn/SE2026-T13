import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  HomeBoardSummary,
  HomeDashboard,
  TaskCardSummary,
} from '@kanban/shared';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';
import { createdSockets } from '../../../test/fake-socket';
import { workspaceResponse } from '../../../test/workspace-fixtures';

const boardId = '22222222-2222-4222-8222-222222222222';
const workspaceId = '33333333-3333-4333-8333-333333333333';
const page = (data: unknown[]) => ({
  status: 200,
  body: {
    success: true,
    statusCode: 200,
    message: 'OK',
    data,
    meta: { page: 1, limit: 100, total: data.length, totalPages: 1 },
  },
});
const task = (n: number, extra: Partial<TaskCardSummary> = {}) => {
  const id = `1111111${n}-1111-4111-8111-111111111111`;
  return {
    id,
    boardId,
    workspaceId,
    title: `Task ${n}`,
    boardName: 'Delivery',
    workspaceName: 'Engineering',
    columnId: '44444444-4444-4444-8444-444444444444',
    startDate: null,
    dueDate: '2026-03-09T12:00:00.000Z',
    updatedAt: '2026-03-08T10:00:00.000Z',
    group: 'NEXT_7_DAYS',
    permalink: `/boards/${boardId}/cards/${id}`,
    labels: [],
    ...extra,
  } satisfies TaskCardSummary;
};
const board = (
  n: number,
  extra: Partial<HomeBoardSummary> = {},
): HomeBoardSummary => {
  const id = `2222222${n}-2222-4222-8222-222222222222`;
  return {
    id,
    workspaceId,
    name: `Board ${n}`,
    backgroundPreset: 'blue',
    isStarred: true,
    lastViewedAt: null,
    path: `/boards/${id}`,
    ...extra,
  };
};
const dashboard = (extra: Partial<HomeDashboard> = {}): HomeDashboard => ({
  summary: {
    assignedActiveCount: 12,
    overdueCount: 2,
    dueNext7DaysCount: 3,
    workspaceCount: 2,
  },
  upNext: [
    task(1, {
      title: 'Fix authentication bug',
      group: 'OVERDUE',
      dueDate: '2026-03-01T12:00:00.000Z',
    }),
    task(2, { title: 'Complete landing page' }),
    task(3, { title: 'Write API docs', group: 'LATER' }),
  ],
  starredBoards: [board(1, { name: 'Frontend Development' })],
  recentBoards: [
    board(2, {
      name: 'Backend Development',
      isStarred: false,
      lastViewedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    }),
  ],
  ...extra,
});
const base = {
  'GET /users/me': ok(testUser),
  'GET /workspaces?page=1&limit=100': page([
    { ...workspaceResponse, id: workspaceId, name: 'Engineering' },
  ]),
  'GET /boards/background-presets': ok([
    { id: 'blue', kind: 'color', value: '#2563eb', foreground: 'light' },
  ]),
};

describe('Home route', () => {
  it('requires authentication', async () => {
    mockApi({});
    const { router } = renderApp('/home');
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(router.state.location.pathname).toBe('/login');
  });

  it('renders the exact server summary, Up Next and Board links without completion controls', async () => {
    storeSession();
    mockApi({ ...base, 'GET /users/me/home': ok(dashboard()) });
    renderApp('/home');
    expect(
      await screen.findByRole('heading', { level: 1, name: /, Ada!/ }),
    ).toBeTruthy();
    const summary = await screen.findByRole('region', { name: 'Summary' });
    for (const [name, href] of [
      ['12 assigned active cards', '/my-tasks'],
      ['3 cards due in the next 7 days', '/my-tasks?group=NEXT_7_DAYS'],
      ['2 overdue cards', '/my-tasks?group=OVERDUE'],
      ['2 workspaces', '/workspaces'],
    ])
      expect(
        within(summary).getByRole('link', { name }).getAttribute('href'),
      ).toBe(href);

    const upNext = screen.getByRole('region', { name: 'Up Next' });
    const first = within(upNext).getByRole('link', {
      name: /Fix authentication bug/,
    });
    expect(first.getAttribute('href')).toBe(dashboard().upNext[0].permalink);
    expect(first.textContent).toContain('Overdue');
    expect(first.textContent).toContain('2026-03-01');
    expect(
      within(upNext).getByRole('link', { name: /Complete landing page/ })
        .textContent,
    ).toContain('Due soon');
    // LATER has no badge; the server group alone decides the label.
    const later = within(upNext).getByRole('link', { name: /Write API docs/ });
    expect(later.textContent).not.toMatch(/Overdue|Due soon/);
    expect(
      within(upNext).getByRole('link', { name: 'View all tasks' }),
    ).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    const starred = screen.getByRole('region', { name: 'Starred Boards' });
    expect(
      within(starred)
        .getByRole('link', { name: 'Frontend Development' })
        .getAttribute('href'),
    ).toBe(dashboard().starredBoards[0].path);
    expect(within(starred).getByText('Engineering')).toBeTruthy();
    expect(
      within(starred)
        .getByRole('link', { name: 'View all starred boards' })
        .getAttribute('href'),
    ).toBe('/boards?view=starred');
    const recent = screen.getByRole('region', { name: 'Recently Viewed' });
    expect(recent.textContent).toContain('Viewed 2 hours ago');
    expect(
      within(recent)
        .getByRole('link', { name: 'View all recently viewed' })
        .getAttribute('href'),
    ).toBe('/boards?view=recent');
  });

  it('marks Home as the current navigation item', async () => {
    storeSession();
    mockApi({ ...base, 'GET /users/me/home': ok(dashboard()) });
    renderApp('/home');
    const home = await screen.findByRole('link', { name: 'Home' });
    expect(home.getAttribute('aria-current')).toBe('page');
  });

  it('shows honest empty states for a new user', async () => {
    storeSession();
    mockApi({
      ...base,
      'GET /users/me/home': ok(
        dashboard({
          summary: {
            assignedActiveCount: 0,
            overdueCount: 0,
            dueNext7DaysCount: 0,
            workspaceCount: 1,
          },
          upNext: [],
          starredBoards: [],
          recentBoards: [],
        }),
      ),
    });
    renderApp('/home');
    expect(await screen.findByText('No assigned cards yet')).toBeTruthy();
    expect(screen.getByText('No starred boards')).toBeTruthy();
    expect(screen.getByText('No recently viewed boards')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '0 assigned active cards' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: '1 workspaces' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Browse boards' })).toHaveLength(
      3,
    );
  });

  it('explains assigned cards without due dates instead of an empty feed', async () => {
    storeSession();
    mockApi({
      ...base,
      'GET /users/me/home': ok(dashboard({ upNext: [] })),
    });
    renderApp('/home');
    expect(await screen.findByText('Nothing due')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Open My Tasks' }).getAttribute('href'),
    ).toBe('/my-tasks');
  });

  it('pages Up Next and Board lists instead of growing the screen', async () => {
    storeSession();
    mockApi({
      ...base,
      'GET /users/me/home': ok(
        dashboard({
          upNext: [1, 2, 3, 4, 5, 6].map((n) => task(n)),
          starredBoards: [1, 2, 3, 4].map((n) => board(n)),
        }),
      ),
    });
    renderApp('/home');
    const upNext = await screen.findByRole('region', { name: 'Up Next' });
    expect(
      within(upNext).getAllByRole('link', { name: /^Task / }),
    ).toHaveLength(4);
    fireEvent.click(
      within(
        within(upNext).getByRole('navigation', { name: 'Up Next pages' }),
      ).getByRole('button', { name: 'Page 2' }),
    );
    expect(
      within(upNext)
        .getAllByRole('link', { name: /^Task / })
        .map((link) => link.textContent?.slice(0, 6)),
    ).toEqual(['Task 5', 'Task 6']);
    const starred = screen.getByRole('region', { name: 'Starred Boards' });
    expect(
      within(starred).getAllByRole('link', { name: /^Board / }),
    ).toHaveLength(3);
    expect(
      within(starred).getByRole('navigation', {
        name: 'Starred Boards pages',
      }),
    ).toBeTruthy();
  });

  it('rejects a malformed aggregate and recovers through Retry', async () => {
    storeSession();
    let attempt = 0;
    mockApi({
      ...base,
      'GET /users/me/home': () =>
        ++attempt === 1
          ? ok({ ...dashboard(), summary: { assignedActiveCount: -1 } })
          : ok(dashboard()),
    });
    renderApp('/home');
    expect(await screen.findByText(/Home is unavailable/)).toBeTruthy();
    expect(screen.queryByText('Fix authentication bug')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Fix authentication bug')).toBeTruthy();
  });

  it('reports an unreachable service', async () => {
    storeSession();
    mockApi({
      ...base,
      'GET /users/me/home': () => {
        throw new TypeError('offline');
      },
    });
    renderApp('/home');
    expect(await screen.findByText(/appear to be offline/)).toBeTruthy();
  });

  it('ends the session after an unauthorized response', async () => {
    storeSession();
    mockApi({ ...base, 'GET /users/me/home': fail(401, 'UNAUTHORIZED') });
    const { router } = renderApp('/home');
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(router.state.location.pathname).toBe('/login');
  });

  it('unstars through the real endpoint, refetches Home and never records a Board view', async () => {
    storeSession();
    let starred = true;
    const calls = mockApi({
      ...base,
      'GET /users/me/home': () =>
        ok(dashboard({ starredBoards: starred ? [board(1)] : [] })),
      [`DELETE /boards/${board(1).id}/star`]: () => {
        starred = false;
        return ok({ isStarred: false, lastViewedAt: null });
      },
    });
    renderApp('/home');
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Remove from starred: Board 1',
      }),
    );
    expect(await screen.findByText('No starred boards')).toBeTruthy();
    expect(
      calls.filter((call) => call.path === '/users/me/home').length,
    ).toBeGreaterThanOrEqual(2);
    expect(calls.some((call) => /\/view/.test(call.path))).toBe(false);
    expect(
      calls.some((call) => call.method !== 'GET' && call.method !== 'DELETE'),
    ).toBe(false);
  });

  it('keeps the list and shows an error when the star request fails', async () => {
    storeSession();
    mockApi({
      ...base,
      'GET /users/me/home': ok(dashboard()),
      [`DELETE /boards/${board(1).id}/star`]: fail(500, 'INTERNAL'),
    });
    renderApp('/home');
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Remove from starred: Frontend Development',
      }),
    );
    expect(await screen.findByText('Star unavailable')).toBeTruthy();
    expect(
      screen
        .getByRole('button', {
          name: 'Remove from starred: Frontend Development',
        })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('refetches Home on an access-change signal and drops revoked Boards', async () => {
    storeSession();
    let revoked = false;
    mockApi({
      ...base,
      'GET /users/me/home': () =>
        ok(dashboard({ starredBoards: revoked ? [] : [board(1)] })),
    });
    renderApp('/home');
    await screen.findByRole('link', { name: 'Board 1' });
    await waitFor(() => expect(createdSockets.length).toBeGreaterThan(0));
    revoked = true;
    act(() => createdSockets.at(-1)!.socket.push('access:changed', {}));
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Board 1' })).toBeNull(),
    );
    expect(await screen.findByText('No starred boards')).toBeTruthy();
  });

  it('does not show a late Home response after an account switch', async () => {
    storeSession('first-token');
    let finish!: () => void;
    const pending = new Promise<ReturnType<typeof ok>>((resolve) => {
      finish = () => resolve(ok(dashboard()));
    });
    const calls = mockApi({ ...base, 'GET /users/me/home': () => pending });
    renderApp('/home');
    await waitFor(() =>
      expect(calls.some((call) => call.path === '/users/me/home')).toBe(true),
    );
    mockApi({
      ...base,
      'GET /users/me': ok({
        ...testUser,
        id: '00000000-0000-4000-8000-000000000002',
        displayName: 'Grace Hopper',
      }),
      'GET /users/me/home': ok(
        dashboard({ upNext: [], starredBoards: [], recentBoards: [] }),
      ),
    });
    storeSession('second-token');
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'kanban.session',
          storageArea: localStorage,
        }),
      ),
    );
    await screen.findByText('No starred boards');
    await act(async () => finish());
    expect(screen.queryByText('Fix authentication bug')).toBeNull();
    expect(screen.queryByText('Frontend Development')).toBeNull();
  });
});
