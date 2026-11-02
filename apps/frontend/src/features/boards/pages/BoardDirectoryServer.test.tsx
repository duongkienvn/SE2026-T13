import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { makeBoard, okPage } from '../../../test/board-fixtures';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

afterEach(() => vi.restoreAllMocks());

it('uses server pagination and URL-backed search without fetching other pages', async () => {
  storeSession();
  const board = makeBoard({ name: 'Server match' });
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    'GET /boards?page=1&limit=20&status=active&sort=updatedAt': okPage(
      [board],
      { limit: 20, total: 41 },
    ),
    'GET /boards?page=2&limit=20&status=active&sort=updatedAt': okPage(
      [board],
      { page: 2, limit: 20, total: 41 },
    ),
    'GET /boards?page=1&limit=20&status=active&sort=updatedAt&q=Server': okPage(
      [board],
      { limit: 20, total: 1 },
    ),
  });
  const { router } = renderApp('/boards');
  await screen.findByRole('link', { name: 'Server match' });
  expect(screen.getByText('41 accessible boards')).toBeTruthy();
  expect(calls.some((call) => call.path.includes('page=2'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
  await waitFor(() => expect(router.state.location.search).toContain('page=2'));
  await waitFor(() =>
    expect(calls.some((call) => call.path.startsWith('/boards?page=2'))).toBe(
      true,
    ),
  );
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search boards' }), {
    target: { value: 'Server' },
  });
  await waitFor(() =>
    expect(router.state.location.search).toContain('q=Server'),
  );
  await screen.findByText('1 accessible board');
  expect(router.state.location.search).not.toContain('page=2');
});

it('renders the saved background in the personal board tile without obscuring actions', async () => {
  storeSession();
  const board = makeBoard({ name: 'Forest board', backgroundPreset: 'forest' });
  mockApi({
    'GET /users/me': ok(testUser),
    'GET /boards?page=1&limit=20&status=active&sort=updatedAt': okPage(
      [board],
      { limit: 20 },
    ),
    'GET /boards/background-presets': ok([
      {
        id: 'forest',
        kind: 'photo',
        value: 'https://example.invalid/photo',
        foreground: 'light',
      },
    ]),
    [`GET /boards/${board.id}/user-state`]: ok({
      isStarred: false,
      lastViewedAt: null,
    }),
  });
  renderApp('/boards');
  const link = await screen.findByRole('link', { name: 'Forest board' });
  const tile = link.closest('article')!;
  await waitFor(() =>
    expect(
      tile.querySelector('[aria-hidden="true"][style]')?.getAttribute('style'),
    ).toContain('/board-backgrounds/forest.jpg'),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Actions for Forest board' }),
  );
  expect(screen.getByRole('button', { name: 'Edit board' })).toBeTruthy();
});

it('retries a temporary star-state failure without treating it as access loss', async () => {
  storeSession();
  const board = makeBoard({ name: 'Recoverable board' });
  let attempts = 0;
  mockApi({
    'GET /users/me': ok(testUser),
    'GET /boards?page=1&limit=20&status=active&sort=updatedAt': okPage(
      [board],
      { limit: 20 },
    ),
    [`GET /boards/${board.id}/user-state`]: () =>
      ++attempts === 1
        ? fail(503, 'UNAVAILABLE')
        : ok({ isStarred: true, lastViewedAt: null }),
  });
  renderApp('/boards');
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Retry star status: Recoverable board',
    }),
  );
  const star = await screen.findByRole('button', {
    name: 'Remove from starred: Recoverable board',
  });
  expect(star.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('link', { name: 'Recoverable board' })).toBeTruthy();
});

it('reuses list star state and preserves sidebar state through Back and Forward', async () => {
  storeSession();
  const board = makeBoard({ name: 'Listed star', isStarred: true });
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    'GET /boards?page=1&limit=20&status=active&sort=updatedAt&starred=true':
      okPage([board]),
    'GET /boards?page=1&limit=20&status=active&sort=updatedAt': okPage([board]),
    [`DELETE /boards/${board.id}/star`]: ok({
      isStarred: false,
      lastViewedAt: null,
    }),
  });
  const { router } = renderApp('/boards?view=starred');
  await screen.findByRole('link', { name: board.name });
  const current = () =>
    [...document.querySelectorAll('a[aria-current="page"]')].map((item) =>
      item.getAttribute('href'),
    );
  expect(current()).toContain('/boards?view=starred');
  expect(current()).not.toContain('/boards');
  expect(screen.queryByRole('button', { name: 'Active' })).toBeNull();
  expect(
    calls.filter((call) => call.path.endsWith('/user-state')),
  ).toHaveLength(0);
  fireEvent.click(
    screen.getByRole('button', { name: 'Remove from starred: Listed star' }),
  );
  await waitFor(() =>
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true),
  );
  expect(router.state.location.search).toBe('?view=starred');
  await router.navigate('/boards');
  await waitFor(() => expect(current()).toContain('/boards'));
  expect(current()).not.toContain('/boards?view=starred');
  await router.navigate(-1);
  await waitFor(() => expect(current()).toContain('/boards?view=starred'));
  await router.navigate(1);
  await waitFor(() => expect(current()).toContain('/boards'));
});

it('creates with the selected preset atomically, retains a failed draft, and resets on reopening', async () => {
  storeSession();
  const board = makeBoard({ name: 'Existing' });
  let attempts = 0;
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    'GET /boards?page=1&limit=20&status=active&sort=updatedAt': okPage([board]),
    'GET /boards/background-presets': ok([
      { id: 'blue', kind: 'color', value: '#2563EB', foreground: 'light' },
      { id: 'forest', kind: 'photo', value: '', foreground: 'light' },
    ]),
    'POST /boards': () =>
      ++attempts === 1
        ? fail(503, 'UNAVAILABLE')
        : ok(makeBoard({ name: 'Created', backgroundPreset: 'forest' })),
  });
  renderApp('/boards');
  fireEvent.click(await screen.findByRole('button', { name: 'Create Board' }));
  fireEvent.change(screen.getByLabelText('Board name'), {
    target: { value: 'Created' },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Photo' }));
  fireEvent.click(screen.getByRole('button', { name: 'forest background' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create board' }));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('Board name') as HTMLInputElement).value).toBe(
    'Created',
  );
  expect(
    screen
      .getByRole('button', { name: 'forest background' })
      .getAttribute('aria-pressed'),
  ).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Create board' }));
  await screen.findByText('Board “Created” created.');
  const writes = calls.filter((call) => call.method === 'POST');
  expect(writes).toHaveLength(2);
  expect(writes[1].body).toEqual({
    name: 'Created',
    description: null,
    backgroundPreset: 'forest',
  });
  expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Create Board' }));
  expect((screen.getByLabelText('Board name') as HTMLInputElement).value).toBe(
    '',
  );
  expect(
    screen
      .getByRole('button', { name: 'blue background' })
      .getAttribute('aria-pressed'),
  ).toBe('true');
});

it.each([403, 404])(
  'removes listed protected Board data after a star toggle receives HTTP %s',
  async (status) => {
    storeSession();
    const board = makeBoard({ name: 'Revoked listed Board', isStarred: true });
    let revoked = false;
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /boards?page=1&limit=20&status=active&sort=updatedAt': () =>
        okPage(revoked ? [] : [board]),
      [`DELETE /boards/${board.id}/star`]: () => {
        revoked = true;
        return fail(status, 'FORBIDDEN');
      },
    });
    renderApp('/boards');
    await screen.findByRole('link', { name: board.name });
    fireEvent.click(
      screen.getByRole('button', {
        name: `Remove from starred: ${board.name}`,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: board.name })).toBeNull(),
    );
    expect(document.body.textContent).not.toContain(board.name);
  },
);
