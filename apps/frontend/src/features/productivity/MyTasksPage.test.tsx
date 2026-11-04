import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fail, mockApi, ok, storeSession, testUser } from '../../test/mock-api';
import { renderApp } from '../../test/render';
import { makeBoard } from '../../test/board-fixtures';
import { workspaceResponse } from '../../test/workspace-fixtures';

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
const task = {
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
const tasks = (data = [task]) => ({
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
    groupCounts: { OVERDUE: 0, NEXT_7_DAYS: 1, LATER: 0, NO_DUE_DATE: 0 },
  },
});

describe('My Tasks route', () => {
  it('requires authentication', async () => {
    mockApi({});
    const { router } = renderApp('/my-tasks');
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(router.state.location.pathname).toBe('/login');
  });

  it('renders real group counts and the returned Card permalink, then filters through the URL', async () => {
    storeSession();
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      'GET /workspaces?page=1&limit=100': page([]),
      'GET /boards?page=1&limit=100': page([]),
      'GET /users/me/tasks?group=ALL&page=1&sort=dueDate': tasks(),
      'GET /users/me/tasks?group=OVERDUE&page=1&sort=dueDate': tasks([]),
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
  });

  it('uses authorized workspace, board and board-scoped labels and clears them on workspace change', async () => {
    storeSession();
    const workspace = workspaceResponse.id;
    const labelId = '55555555-5555-4555-8555-555555555555';
    const prefix = '/users/me/tasks?group=ALL&page=1&sort=dueDate';
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /workspaces?page=1&limit=100': page([workspaceResponse]),
      'GET /boards?page=1&limit=100': page([
        makeBoard({ id: boardId, name: 'Delivery', workspaceId: workspace }),
      ]),
      [`GET ${prefix}`]: tasks(),
      [`GET ${prefix}&workspaceId=${workspace}`]: tasks(),
      [`GET ${prefix}&workspaceId=${workspace}&boardId=${boardId}`]: tasks(),
      [`GET ${prefix}&workspaceId=${workspace}&boardId=${boardId}&labelIds=${labelId}`]:
        tasks(),
      [`GET /boards/${boardId}/labels?page=1&limit=100`]: page([
        {
          id: labelId,
          boardId,
          name: 'Backend',
          color: '#615CF7',
          createdAt: task.updatedAt,
          updatedAt: task.updatedAt,
        },
      ]),
    });
    const { router } = renderApp('/my-tasks');
    await screen.findByRole('link', { name: /Review API contract/ });
    fireEvent.click(screen.getByText('Filters and sorting'));
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
    label.selected = true;
    fireEvent.change(screen.getByLabelText('Labels (match any)'));
    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get('labelIds'),
      ).toBe(labelId),
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
  });

  it('shows a safe access error and retries without retaining task text', async () => {
    storeSession();
    let attempt = 0;
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /workspaces?page=1&limit=100': page([]),
      'GET /boards?page=1&limit=100': page([]),
      'GET /users/me/tasks?group=ALL&page=1&sort=dueDate': () =>
        ++attempt === 1 ? fail(403, 'FORBIDDEN') : tasks(),
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
  });
});
