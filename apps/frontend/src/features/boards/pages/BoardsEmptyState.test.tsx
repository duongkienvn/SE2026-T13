import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeBoard, okPage } from '../../../test/board-fixtures';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

const active = 'GET /boards?page=1&limit=20&status=active&sort=updatedAt';
const archived = 'GET /boards?page=1&limit=20&status=archived&sort=updatedAt';
const archiveCheck =
  'GET /boards?page=1&limit=1&status=archived&sort=updatedAt';
const welcome = 'Your next big idea starts here';

function setup(handlers: Parameters<typeof mockApi>[0] = {}, path = '/boards') {
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    [active]: okPage([], { limit: 20 }),
    [archiveCheck]: okPage([], { limit: 1 }),
    'GET /boards/background-presets': ok([
      { id: 'blue', kind: 'color', value: '#2563EB', foreground: 'light' },
    ]),
    ...handlers,
  });
  return { calls, ...renderApp(path) };
}

describe('Boards empty states', () => {
  it('welcomes a truly empty account without page controls or the zero counter', async () => {
    const { calls } = setup();
    await screen.findByRole('heading', { name: welcome });
    expect(
      screen.getByRole('heading', { name: 'Boards', level: 1 }),
    ).toBeTruthy();
    expect(screen.getByText('Your boards across all workspaces.')).toBeTruthy();
    expect(
      screen.getByText(
        'Create your first board to organize tasks, track progress, and collaborate with your team.',
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole('searchbox', { name: 'Search boards' }),
    ).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Board status' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Sort boards' })).toBeNull();
    expect(screen.queryByText('0 accessible boards')).toBeNull();
    expect(screen.queryByText('No boards yet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
    expect(
      calls.filter((call) => call.path.startsWith('/boards?')),
    ).toHaveLength(2);
    fireEvent.click(
      screen.getByRole('button', { name: 'Create your first board' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Create a new board' });
    expect(within(dialog).getByLabelText('Board name')).toBe(
      document.activeElement,
    );
  });

  it('preserves the populated list and toolbar without an archive existence request', async () => {
    const board = makeBoard({ name: 'Existing board' });
    const { calls } = setup({ [active]: okPage([board], { limit: 20 }) });
    await screen.findByRole('link', { name: board.name });
    expect(
      screen.getByRole('searchbox', { name: 'Search boards' }),
    ).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Board status' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Sort boards' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Board' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: welcome })).toBeNull();
    expect(calls.some((call) => `GET ${call.path}` === archiveCheck)).toBe(
      false,
    );
  });

  it('keeps search controls for no matches and resets the search', async () => {
    const board = makeBoard({ name: 'Existing board' });
    const { router, calls } = setup(
      {
        [active]: okPage([board]),
        [`${active}&q=missing`]: okPage([], { limit: 20 }),
      },
      '/boards?q=missing',
    );
    await screen.findByRole('heading', { name: 'No matching boards' });
    expect(
      screen.getByRole('searchbox', { name: 'Search boards' }),
    ).toHaveProperty('value', 'missing');
    expect(
      screen.queryByRole('button', { name: 'Create your first board' }),
    ).toBeNull();
    expect(calls.some((call) => `GET ${call.path}` === archiveCheck)).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    await screen.findByRole('link', { name: board.name });
    expect(router.state.location.search).toBe('');
  });

  it('keeps archived-only boards discoverable and permits creation', async () => {
    const board = makeBoard({ name: 'Archived board', isArchived: true });
    setup({
      [archiveCheck]: okPage([board], { limit: 1 }),
      [archived]: okPage([board]),
    });
    await screen.findByRole('heading', { name: 'No active boards' });
    expect(screen.getByRole('combobox', { name: 'Board status' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Board' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: welcome })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'View archived boards' }),
    );
    await screen.findByRole('link', { name: board.name });
  });

  it('shows a contextual empty archived filter with a reset action', async () => {
    setup({ [archived]: okPage([]) }, '/boards?status=archived');
    await screen.findByRole('heading', { name: 'No archived boards' });
    expect(
      screen.getByRole('combobox', { name: 'Board status' }),
    ).toHaveProperty('value', 'archived');
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: welcome })).toBeNull();
  });

  it.each([active, archiveCheck])(
    'waits for %s before showing a welcome',
    async (request) => {
      let resolve!: (response: MockResponse) => void;
      const pending = new Promise<MockResponse>((done) => {
        resolve = done;
      });
      setup({ [request]: () => pending });
      await screen.findByText('Loading boards…');
      expect(screen.queryByRole('heading', { name: welcome })).toBeNull();
      expect(screen.queryByText('No boards yet')).toBeNull();
      await act(async () => {
        resolve(okPage([]));
      });
      await screen.findByRole('heading', { name: welcome });
    },
  );

  it.each([active, archiveCheck])(
    'does not mistake a failed %s for an empty account',
    async (request) => {
      let attempts = 0;
      setup({
        [request]: () =>
          ++attempts === 1 ? fail(503, 'UNAVAILABLE') : okPage([]),
      });
      await screen.findByRole('alert');
      expect(screen.queryByRole('heading', { name: welcome })).toBeNull();
      expect(screen.queryByText('No boards yet')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await screen.findByRole('heading', { name: welcome });
    },
  );

  it('exits the welcome state after creating the first board using normal invalidation', async () => {
    const board = makeBoard({ name: 'My first board' });
    let created = false;
    setup({
      [active]: () => okPage(created ? [board] : [], { limit: 20 }),
      'POST /boards': () => {
        created = true;
        return ok(board, 201);
      },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create your first board' }),
    );
    fireEvent.change(screen.getByLabelText('Board name'), {
      target: { value: board.name },
    });
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Create board',
      }),
    );
    await screen.findByRole('link', { name: board.name });
    expect(screen.queryByRole('heading', { name: welcome })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByRole('searchbox', { name: 'Search boards' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Board' })).toBeTruthy();
  });
});
