import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBoard, okPage } from '../../../test/board-fixtures';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

const active = 'GET /boards?page=1&limit=20&status=active&sort=updatedAt';
const archived = 'GET /boards?page=1&limit=20&status=archived&sort=updatedAt';
const second = 'GET /boards?page=2&limit=20&status=active&sort=updatedAt';
const searched =
  'GET /boards?page=1&limit=20&status=active&sort=updatedAt&q=Roadmap';
const sorted = 'GET /boards?page=1&limit=20&status=active&sort=name';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem('kanvexa.sidebar.expanded');
});

describe('server-backed Board directory', () => {
  it('loads only the requested page, preserves totals and supports Back', async () => {
    storeSession();
    const first = makeBoard({ name: 'First page' });
    const next = makeBoard({ name: 'Second page' });
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [active]: okPage([first], { limit: 20, total: 41 }),
      [second]: okPage([next], { page: 2, limit: 20, total: 41 }),
    });
    const { router } = renderApp('/boards');
    await screen.findByRole('link', { name: 'First page' });
    expect(screen.getByText('41 accessible boards')).toBeTruthy();
    expect(calls.some((call) => call.path.startsWith('/boards?page=2'))).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    await screen.findByRole('link', { name: 'Second page' });
    expect(router.state.location.search).toContain('page=2');
    await router.navigate(-1);
    await screen.findByRole('link', { name: 'First page' });
  });

  it('debounces search, resets page and restores URL state', async () => {
    storeSession();
    const board = makeBoard({ name: 'Roadmap' });
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [active]: okPage([board], { limit: 20, total: 41 }),
      [searched]: okPage([board], { limit: 20 }),
    });
    const { router } = renderApp('/boards');
    await screen.findByRole('link', { name: 'Roadmap' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search boards' }), {
      target: { value: 'Roadmap' },
    });
    await waitFor(() =>
      expect(calls.some((call) => call.path.includes('q=Roadmap'))).toBe(true),
    );
    expect(router.state.location.search).toContain('q=Roadmap');
    expect(screen.getByText('1 accessible board')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() =>
      expect(router.state.location.search).not.toContain('q='),
    );
  });

  it('requests archived boards and name ordering from the server', async () => {
    storeSession();
    const board = makeBoard({ name: 'Archived', isArchived: true });
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [active]: okPage([], { limit: 20 }),
      [archived]: okPage([board], { limit: 20 }),
      'GET /boards?page=1&limit=1&status=archived&sort=updatedAt': okPage(
        [board],
        { limit: 1 },
      ),
      'GET /boards?page=1&limit=20&status=archived&sort=name': okPage([board], {
        limit: 20,
      }),
      [sorted]: okPage([], { limit: 20 }),
    });
    renderApp('/boards');
    await screen.findByRole('heading', { name: 'No active boards' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort boards' }), {
      target: { value: 'name-asc' },
    });
    await waitFor(() =>
      expect(calls.some((call) => call.path.includes('sort=name'))).toBe(true),
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Board status' }), {
      target: { value: 'archived' },
    });
    await waitFor(() =>
      expect(calls.some((call) => call.path.includes('status=archived'))).toBe(
        true,
      ),
    );
  });

  it('shows an actionable error and retries without inventing boards', async () => {
    storeSession();
    let attempts = 0;
    mockApi({
      'GET /boards?page=1&limit=1&status=archived&sort=updatedAt': okPage([], {
        limit: 1,
      }),
      'GET /users/me': ok(testUser),
      [active]: () =>
        ++attempts === 1 ? fail(503, 'UNAVAILABLE') : okPage([], { limit: 20 }),
    });
    renderApp('/boards');
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', {
      name: 'Your next big idea starts here',
    });
  });
});
