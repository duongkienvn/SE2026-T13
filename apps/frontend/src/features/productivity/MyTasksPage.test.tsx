import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, ok, storeSession, testUser } from '../../test/mock-api';
import { renderApp } from '../../test/render';

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
});
