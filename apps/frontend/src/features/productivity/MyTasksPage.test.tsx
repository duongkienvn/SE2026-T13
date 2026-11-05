import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fail, mockApi, ok, storeSession, testUser } from '../../test/mock-api';
import { renderApp } from '../../test/render';
import { makeBoard } from '../../test/board-fixtures';
import { workspaceResponse } from '../../test/workspace-fixtures';
import { createdSockets } from '../../test/fake-socket';
import type { TaskCardSummary, TaskGroupCounts } from '@kanban/shared';

const boardId = '22222222-2222-4222-8222-222222222222';
const cardId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '33333333-3333-4333-8333-333333333333';
const page = (data: unknown[], total = data.length) => ({
  status: 200,
  body: {
    success: true,
    statusCode: 200,
    message: 'OK',
    data,
    meta: { page: 1, limit: 100, total, totalPages: total ? 1 : 0 },
  },
});
const task: TaskCardSummary = {
  id: cardId,
  boardId,
  workspaceId,
  title: 'Review API contract',
  boardName: 'Delivery',
  workspaceName: 'Engineering',
  columnId: '44444444-4444-4444-8444-444444444444',
  startDate: null,
  dueDate: '2026-03-09T12:00:00.000Z',
  updatedAt: '2026-03-08T10:00:00.000Z',
  group: 'NEXT_7_DAYS',
  permalink: `/boards/${boardId}/cards/${cardId}`,
  labels: [],
};
const tasks = (data: TaskCardSummary[] = [task], counts?: TaskGroupCounts) => ({
  status: 200,
  body: {
    success: true,
    statusCode: 200,
    message: 'OK',
    data,
    meta: {
      page: 1,
      limit: 20,
      total: data.length,
      totalPages: data.length ? 1 : 0,
    },
    groupCounts: counts ?? {
      OVERDUE: 0,
      NEXT_7_DAYS: data.length,
      LATER: 0,
      NO_DUE_DATE: 0,
    },
  },
});

describe('My Tasks route', () => {
  it.each([
    'invalid-page',
    'page-clamp',
    'revoked-board',
    'invalid-label',
    'label-access-lost',
  ])(
    'replaces the %s correction without trapping Back/Forward',
    async (scenario) => {
      storeSession();
      const labelId = '55555555-5555-4555-8555-555555555555';
      const hasBoard = scenario.includes('label');
      const initial =
        scenario === 'invalid-page'
          ? '?page=invalid'
          : scenario === 'page-clamp'
            ? '?page=9'
            : `?boardId=${boardId}&labelIds=${labelId}`;
      const corrected =
        hasBoard && scenario !== 'label-access-lost'
          ? `?boardId=${boardId}`
          : '';
      const outOfRange = tasks([]);
      outOfRange.body.meta = { page: 9, limit: 20, total: 1, totalPages: 1 };
      const prefix = 'GET /users/me/tasks?group=ALL&page=1&sort=dueDate';
      mockApi({
        'GET /users/me': ok(testUser),
        'GET /workspaces?page=1&limit=100': page([]),
        'GET /boards?page=1&limit=100': page(
          hasBoard
            ? [makeBoard({ id: boardId, name: 'Delivery', workspaceId })]
            : [],
        ),
        [`GET /boards/${boardId}/labels?page=1&limit=100`]:
          scenario === 'label-access-lost' ? fail(403, 'FORBIDDEN') : page([]),
        [prefix]: tasks(),
        [`${prefix}&boardId=${boardId}`]: tasks(),
        [`${prefix}&boardId=${boardId}&labelIds=${labelId}`]: tasks(),
        'GET /users/me/tasks?group=ALL&page=9&sort=dueDate': outOfRange,
      });
      const { router } = renderApp('/');
      await act(() => router.navigate(`/my-tasks${initial}`));
      await waitFor(() => expect(router.state.location.search).toBe(corrected));
      expect(router.state.historyAction).toBe('REPLACE');
      await act(() => router.navigate(-1));
      expect(router.state.location.pathname).toBe('/');
      await act(() => router.navigate(1));
      await waitFor(() =>
        expect(
          router.state.location.pathname + router.state.location.search,
        ).toBe(`/my-tasks${corrected}`),
      );
      await act(() => router.navigate(-1));
      expect(router.state.location.pathname).toBe('/');
    },
  );

  it('requires authentication', async () => {
    mockApi({});
    const { router } = renderApp('/my-tasks');
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(router.state.location.pathname).toBe('/login');
  });

  it('pushes user pagination changes and restores them with Back/Forward', async () => {
    storeSession();
    const first = tasks();
    first.body.meta = { page: 1, limit: 20, total: 21, totalPages: 2 };
    const second = tasks([{ ...task, title: 'Second page card' }]);
    second.body.meta = { page: 2, limit: 20, total: 21, totalPages: 2 };
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /workspaces?page=1&limit=100': page([]),
      'GET /boards?page=1&limit=100': page([]),
      'GET /users/me/tasks?group=ALL&page=1&sort=dueDate': first,
      'GET /users/me/tasks?group=ALL&page=2&sort=dueDate': second,
    });
    const { router } = renderApp('/my-tasks');
    fireEvent.click(await screen.findByRole('button', { name: 'Page 2' }));
    await screen.findByText('Second page card');
    expect(router.state.historyAction).toBe('PUSH');
    expect(router.state.location.search).toBe('?page=2');
    await act(() => router.navigate(-1));
    await screen.findByText('Review API contract');
    expect(router.state.location.search).toBe('');
    await act(() => router.navigate(1));
    await screen.findByText('Second page card');
    expect(router.state.location.search).toBe('?page=2');
  });

  it('renders all four server groups, including no due date', async () => {
    storeSession();
    const grouped = tasks(
      [
        {
          ...task,
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          permalink: `/boards/${boardId}/cards/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
          title: 'Past',
          group: 'OVERDUE',
          dueDate: '2026-03-01T12:00:00.000Z',
        },
        task,
        {
          ...task,
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          permalink: `/boards/${boardId}/cards/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
          title: 'Future',
          group: 'LATER',
          dueDate: '2026-04-01T12:00:00.000Z',
        },
        {
          ...task,
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          permalink: `/boards/${boardId}/cards/cccccccc-cccc-4ccc-8ccc-cccccccccccc`,
          title: 'Undated',
          group: 'NO_DUE_DATE',
          dueDate: null,
        },
      ],
      { OVERDUE: 1, NEXT_7_DAYS: 1, LATER: 1, NO_DUE_DATE: 1 },
    );
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /workspaces?page=1&limit=100': page([]),
      'GET /boards?page=1&limit=100': page([]),
      'GET /users/me/tasks?group=ALL&page=1&sort=dueDate': grouped,
    });
    renderApp('/my-tasks');
    for (const heading of [
      'Overdue (1)',
      'Next 7 days (1)',
      'Later (1)',
      'No due date (1)',
    ])
      expect(
        await screen.findByRole('heading', { name: heading }),
      ).toBeTruthy();
    expect(screen.getByText('No due date')).toBeTruthy();
  });

  it('renders real group counts and the returned Card permalink, then filters through the URL', async () => {
    storeSession();
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      'GET /workspaces?page=1&limit=100': page([]),
      'GET /boards?page=1&limit=100': page([]),
      'GET /users/me/tasks?group=ALL&page=1&sort=dueDate': tasks(),
      'GET /users/me/tasks?group=ALL&page=1&sort=board': tasks(),
      'GET /users/me/tasks?group=ALL&page=1&sort=updatedAt': tasks(),
      'GET /users/me/tasks?group=OVERDUE&page=1&sort=dueDate': tasks([], {
        OVERDUE: 0,
        NEXT_7_DAYS: 1,
        LATER: 0,
        NO_DUE_DATE: 0,
      }),
    });
    const { router } = renderApp('/my-tasks');
    const link = await screen.findByRole('link', {
      name: /Review API contract/,
    });
    expect(link.getAttribute('href')).toBe(task.permalink);
    expect(
      screen.getByRole('heading', { name: 'Next 7 days (1)' }),
    ).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Overdue (0)' }));
    await waitFor(() =>
      expect(router.state.location.search).toBe('?group=OVERDUE'),
    );
    expect(await screen.findByText('No matching tasks')).toBeTruthy();
    expect(
      calls.some((call) => call.path.includes('/users/me/tasks?group=OVERDUE')),
    ).toBe(true);
    await act(() => router.navigate(-1));
    expect(
      await screen.findByRole('link', { name: /Review API contract/ }),
    ).toBeTruthy();
    await act(() => router.navigate(1));
    expect(await screen.findByText('No matching tasks')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Reset filters' })[0],
    );
    await waitFor(() => expect(router.state.location.search).toBe(''));
    fireEvent.change(screen.getByLabelText('Sort by'), {
      target: { value: 'board' },
    });
    await waitFor(() =>
      expect(router.state.location.search).toBe('?sort=board'),
    );
    fireEvent.change(screen.getByLabelText('Sort by'), {
      target: { value: 'updatedAt' },
    });
    await waitFor(() =>
      expect(router.state.location.search).toBe('?sort=updatedAt'),
    );
  });

  it('discloses advanced filters without changing URL state and resets from the toolbar', async () => {
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /workspaces?page=1&limit=100': page([]),
      'GET /boards?page=1&limit=100': page([]),
      'GET /users/me/tasks?group=ALL&page=1&sort=dueDate': tasks(),
      'GET /users/me/tasks?group=ALL&page=1&sort=dueDate&dueFrom=2026-03-01T00%3A00%3A00.000Z':
        tasks(),
    });
    const { router } = renderApp('/my-tasks?dueFrom=2026-03-01');
    await screen.findByRole('link', { name: /Review API contract/ });
    const toggle = screen.getByRole('button', { name: /^Filters/ });
    const panel = document.getElementById(
      toggle.getAttribute('aria-controls')!,
    )!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
    expect(screen.getByLabelText('1 active filter')).toBeTruthy();
    fireEvent.click(toggle);
    expect(panel.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Due from').getAttribute('value')).toBe(
      '2026-03-01',
    );
    fireEvent.click(toggle);
    expect(panel.hidden).toBe(true);
    expect(router.state.location.search).toBe('?dueFrom=2026-03-01');
    fireEvent.click(screen.getByRole('button', { name: 'Labels: All' }));
    expect(panel.hidden).toBe(false);
    expect(
      screen.getByText('Select a Board to filter by labels.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.queryByLabelText('1 active filter')).toBeNull();
  });

  it('uses authorized workspace, board and board-scoped labels and clears them on workspace change', async () => {
    storeSession();
    const workspace = workspaceResponse.id;
    const labelId = '55555555-5555-4555-8555-555555555555';
    const otherLabelId = '66666666-6666-4666-8666-666666666666';
    const teamTask = {
      ...task,
      workspaceId: workspace,
      labels: [{ id: labelId, name: 'Backend', color: '#615CF7' }],
    };
    const prefix = '/users/me/tasks?group=ALL&page=1&sort=dueDate';
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /workspaces?page=1&limit=100': page([workspaceResponse]),
      'GET /boards?page=1&limit=100': page([
        makeBoard({ id: boardId, name: 'Delivery', workspaceId: workspace }),
      ]),
      [`GET ${prefix}`]: tasks([teamTask]),
      [`GET ${prefix}&workspaceId=${workspace}`]: tasks([teamTask]),
      [`GET ${prefix}&workspaceId=${workspace}&boardId=${boardId}`]: tasks([
        teamTask,
      ]),
      [`GET ${prefix}&workspaceId=${workspace}&boardId=${boardId}&labelIds=${labelId}%2C${otherLabelId}`]:
        tasks([teamTask]),
      [`GET /boards/${boardId}/labels?page=1&limit=100`]: page([
        {
          id: labelId,
          boardId,
          name: 'Backend',
          color: '#615CF7',
          createdAt: task.updatedAt,
          updatedAt: task.updatedAt,
        },
        {
          id: otherLabelId,
          boardId,
          name: 'Design',
          color: '#615CF7',
          createdAt: task.updatedAt,
          updatedAt: task.updatedAt,
        },
      ]),
    });
    const { router } = renderApp('/my-tasks');
    await screen.findByRole('link', { name: /Review API contract/ });
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    await screen.findByRole('option', { name: 'Engineering' });
    fireEvent.change(screen.getByLabelText('Workspace'), {
      target: { value: workspace },
    });
    await screen.findByRole('option', { name: 'Delivery' });
    fireEvent.change(screen.getByLabelText('Board'), {
      target: { value: boardId },
    });
    const label = (await screen.findByRole('option', {
      name: 'Backend',
    })) as HTMLOptionElement;
    const otherLabel = screen.getByRole('option', {
      name: 'Design',
    }) as HTMLOptionElement;
    label.selected = true;
    otherLabel.selected = true;
    fireEvent.change(screen.getByLabelText('Labels (match any)'));
    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get('labelIds'),
      ).toBe(`${labelId},${otherLabelId}`),
    );
    fireEvent.change(screen.getByLabelText('Workspace'), {
      target: { value: '' },
    });
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(
      screen.getByText('Select a Board to filter by labels.'),
    ).toBeTruthy();
  });

  it('sends inclusive and exclusive local-day boundaries across DST', async () => {
    storeSession();
    const query = new URLSearchParams({
      group: 'ALL',
      page: '1',
      sort: 'dueDate',
      dueFrom: '2026-03-08T05:00:00.000Z',
      dueTo: '2026-03-09T04:00:00.000Z',
    });
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      'GET /users/me/preferences': ok({
        theme: 'light',
        timeZone: 'America/New_York',
        dateFormat: 'MM/DD/YYYY',
        weekStartsOn: 'monday',
      }),
      'GET /workspaces?page=1&limit=100': page([]),
      'GET /boards?page=1&limit=100': page([]),
      [`GET /users/me/tasks?${query}`]: tasks(),
    });
    renderApp('/my-tasks?dueFrom=2026-03-08&dueTo=2026-03-08');
    await screen.findByRole('link', { name: /Review API contract/ });
    expect(calls.some((call) => call.path === `/users/me/tasks?${query}`)).toBe(
      true,
    );
    expect(screen.getByText('03/09/2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    expect(
      screen.getByText(
        /Applied dates: 03\/08\/2026 – 03\/08\/2026 \(America\/New_York\)/,
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Due through'), {
      target: { value: '2026-03-07' },
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'end date must be on or after',
    );
  });

  it.each([403, 404])(
    'shows a safe %s access error and retries without retaining task text',
    async (status) => {
      storeSession();
      let attempt = 0;
      mockApi({
        'GET /users/me': ok(testUser),
        'GET /workspaces?page=1&limit=100': page([]),
        'GET /boards?page=1&limit=100': page([]),
        'GET /users/me/tasks?group=ALL&page=1&sort=dueDate': () =>
          ++attempt === 1
            ? fail(status, status === 403 ? 'FORBIDDEN' : 'NOT_FOUND')
            : tasks(),
      });
      renderApp('/my-tasks');
      expect(
        await screen.findByText(/Your access may have changed/),
      ).toBeTruthy();
      expect(screen.queryByText('Review API contract')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(
        await screen.findByRole('link', { name: /Review API contract/ }),
      ).toBeTruthy();
    },
  );

  it('ends the session after an unauthorized task response', async () => {
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /workspaces?page=1&limit=100': page([]),
      'GET /boards?page=1&limit=100': page([]),
      'GET /users/me/tasks?group=ALL&page=1&sort=dueDate': fail(
        401,
        'UNAUTHORIZED',
      ),
    });
    const { router } = renderApp('/my-tasks');
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByText('Review API contract')).toBeNull();
  });

  it('reports an unreachable task service and can retry', async () => {
    storeSession();
    let attempt = 0;
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /workspaces?page=1&limit=100': page([]),
      'GET /boards?page=1&limit=100': page([]),
      'GET /users/me/tasks?group=ALL&page=1&sort=dueDate': () => {
        if (++attempt === 1) throw new TypeError('offline');
        return tasks();
      },
    });
    renderApp('/my-tasks');
    expect(await screen.findByText(/appear to be offline/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('link', { name: /Review API contract/ }),
    ).toBeTruthy();
  });

  it('clears cached task text when the selected Board label catalog refuses access', async () => {
    storeSession();
    let deny!: () => void;
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /workspaces?page=1&limit=100': page([]),
      'GET /boards?page=1&limit=100': page([
        makeBoard({ id: boardId, name: 'Delivery', workspaceId }),
      ]),
      [`GET /boards/${boardId}/labels?page=1&limit=100`]: () =>
        new Promise((resolve) => {
          deny = () => resolve(fail(403, 'FORBIDDEN'));
        }),
      [`GET /users/me/tasks?group=ALL&page=1&sort=dueDate&boardId=${boardId}`]:
        tasks(),
      'GET /users/me/tasks?group=ALL&page=1&sort=dueDate': tasks([]),
    });
    const { router } = renderApp(`/my-tasks?boardId=${boardId}`);
    await screen.findByRole('link', { name: /Review API contract/ });
    await waitFor(() => expect(deny).toBeTypeOf('function'));
    deny();
    await waitFor(() =>
      expect(router.state.location.search).not.toContain('boardId'),
    );
    await waitFor(() =>
      expect(screen.queryByText('Review API contract')).toBeNull(),
    );
  });

  it('does not show a late response after an account switch', async () => {
    storeSession('first-token');
    let finish!: () => void;
    const pending = new Promise<ReturnType<typeof tasks>>((resolve) => {
      finish = () => resolve(tasks());
    });
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      'GET /workspaces?page=1&limit=100': page([]),
      'GET /boards?page=1&limit=100': page([]),
      'GET /users/me/tasks?group=ALL&page=1&sort=dueDate': () => pending,
    });
    renderApp('/my-tasks');
    await waitFor(() =>
      expect(
        calls.some((call) => call.path.startsWith('/users/me/tasks?')),
      ).toBe(true),
    );
    mockApi({
      'GET /users/me': ok({
        ...testUser,
        id: '00000000-0000-4000-8000-000000000002',
        displayName: 'Grace Hopper',
      }),
      'GET /workspaces?page=1&limit=100': page([]),
      'GET /boards?page=1&limit=100': page([]),
      'GET /users/me/tasks?group=ALL&page=1&sort=dueDate': tasks([]),
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
    await screen.findByText('No assigned tasks yet');
    await act(async () => finish());
    expect(screen.queryByText('Review API contract')).toBeNull();
    expect(screen.getByText('No assigned tasks yet')).toBeTruthy();
  });

  it('does not show a late response for an earlier URL', async () => {
    storeSession();
    let finish!: () => void;
    const pending = new Promise<ReturnType<typeof tasks>>((resolve) => {
      finish = () => resolve(tasks());
    });
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      'GET /workspaces?page=1&limit=100': page([]),
      'GET /boards?page=1&limit=100': page([]),
      'GET /users/me/tasks?group=ALL&page=1&sort=dueDate': () => pending,
      'GET /users/me/tasks?group=OVERDUE&page=1&sort=dueDate': tasks([]),
    });
    const { router } = renderApp('/my-tasks');
    await waitFor(() =>
      expect(calls.some((call) => call.path.includes('group=ALL'))).toBe(true),
    );
    await act(() => router.navigate('/my-tasks?group=OVERDUE'));
    await screen.findByText('No matching tasks');
    await act(async () => finish());
    expect(screen.queryByText('Review API contract')).toBeNull();
    expect(screen.getByText('No matching tasks')).toBeTruthy();
  });

  it('returns to page one when an existing access-change signal invalidates tasks', async () => {
    storeSession();
    const secondPage = tasks();
    secondPage.body.meta = { page: 2, limit: 20, total: 21, totalPages: 2 };
    secondPage.body.groupCounts.NEXT_7_DAYS = 21;
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /workspaces?page=1&limit=100': page([]),
      'GET /boards?page=1&limit=100': page([]),
      'GET /users/me/tasks?group=ALL&page=2&sort=dueDate': secondPage,
      'GET /users/me/tasks?group=ALL&page=1&sort=dueDate': tasks(),
    });
    const { router } = renderApp('/my-tasks?page=2');
    await screen.findByRole('link', { name: /Review API contract/ });
    await waitFor(() => expect(createdSockets.length).toBeGreaterThan(0));
    act(() => createdSockets.at(-1)!.socket.push('access:changed', {}));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(
      await screen.findByRole('link', { name: /Review API contract/ }),
    ).toBeTruthy();
  });

  it('clamps an out-of-range page only after the server confirms the last page', async () => {
    storeSession();
    const outOfRange = tasks([], {
      OVERDUE: 0,
      NEXT_7_DAYS: 1,
      LATER: 0,
      NO_DUE_DATE: 0,
    });
    outOfRange.body.meta = { page: 9, limit: 20, total: 1, totalPages: 1 };
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /workspaces?page=1&limit=100': page([]),
      'GET /boards?page=1&limit=100': page([]),
      'GET /users/me/tasks?group=ALL&page=9&sort=dueDate': outOfRange,
      'GET /users/me/tasks?group=ALL&page=1&sort=dueDate': tasks(),
    });
    const { router } = renderApp('/my-tasks?page=9');
    expect(
      await screen.findByRole('link', { name: /Review API contract/ }),
    ).toBeTruthy();
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });
});
