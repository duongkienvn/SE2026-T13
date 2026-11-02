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
