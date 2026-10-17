import { focusManager } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Board } from '../types';
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

function openBoard(
  board: Board,
  extra: Record<string, MockResponse | (() => MockResponse)> = {},
) {
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    [`GET /boards/${board.id}`]: ok(board),
    [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([]),
    [`GET /boards/${board.id}/cards?page=1&limit=100`]: okPage([]),
    [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
    ...extra,
  });
  const view = renderApp(`/boards/${board.id}`);
  return { calls, ...view };
}

/** Returns `first` once, then `after` for every refetch. */
function then(first: MockResponse, after: MockResponse) {
  let calls = 0;
  return () => (calls++ === 0 ? first : after);
}

/** Simulates returning to the tab, which refetches stale queries. */
function refocusWindow() {
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
}

afterEach(() => focusManager.setFocused(undefined));

describe('BoardDetailPage', () => {
  it('shows the board with role, members link and tab title', async () => {
    const board = makeBoard({
      name: 'Product Development',
      description: 'From idea to launch.',
      currentUserRole: 'MEMBER',
    });
    openBoard(board);

    const main = within(await screen.findByRole('main'));
    expect(
      await main.findByRole('heading', { name: 'Product Development' }),
    ).toBeTruthy();
    expect(main.getByText('From idea to launch.')).toBeTruthy();
    expect(main.getByText('Member')).toBeTruthy();
    expect(
      main.getByRole('link', { name: 'Members' }).getAttribute('href'),
    ).toBe(`/boards/${board.id}/members`);
    expect(
      await main.findByRole('heading', { name: 'No columns yet' }),
    ).toBeTruthy();
    expect(document.title).toBe('Product Development · Kanban');
  });

  it('shows the board name in the header and enables Board members in the sidebar', async () => {
    const board = makeBoard({ name: 'Design Team' });
    const { router } = openBoard(board);

    const header = await screen.findByRole('banner');
    expect(
      await within(header).findByRole('link', { name: 'Design Team' }),
    ).toBeTruthy();

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(
      within(nav)
        .getByRole('button', { name: 'Boards' })
        .getAttribute('aria-current'),
    ).toBe('page');
    const members = within(nav).getByRole('button', { name: 'Board members' });
    expect(members.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(members);
    expect(router.state.location.pathname).toBe(`/boards/${board.id}/members`);
  });

  it('keeps Board members disabled outside a board', async () => {
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /boards?page=1&limit=100': okPage([]),
    });
    renderApp('/boards');

    const nav = await screen.findByRole('navigation', { name: 'Primary' });
    expect(
      within(nav)
        .getByRole('button', { name: 'Board members (coming soon)' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('offers edit and archive to owners only', async () => {
    const owned = makeBoard({ name: 'Mine', currentUserRole: 'OWNER' });
    openBoard(owned);
    expect(
      await screen.findByRole('button', { name: 'Actions for Mine' }),
    ).toBeTruthy();
  });

  it('hides owner actions from members', async () => {
    const shared = makeBoard({ name: 'Theirs', currentUserRole: 'MEMBER' });
    openBoard(shared);
    await screen.findByRole('heading', { name: 'Theirs' });
    expect(
      screen.queryByRole('button', { name: 'Actions for Theirs' }),
    ).toBeNull();
  });

  it.each([
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
  ])(
    'treats %s the same: board not found or no access',
    async (status, code) => {
      const board = makeBoard();
      openBoard(board, { [`GET /boards/${board.id}`]: fail(status, code) });

      expect(
        await screen.findByRole('heading', { name: 'Board not found' }),
      ).toBeTruthy();
      expect(
        screen
          .getByRole('link', { name: 'Back to boards' })
          .getAttribute('href'),
      ).toBe('/boards');
      // No empty board-name slot (or stray divider) in the header.
      const header = screen.getByRole('banner');
      expect(within(header).queryAllByRole('link')).toHaveLength(0);
      expect(header.querySelector('.bg-line')).toBeNull();
    },
  );

  it('archives, then returns to the boards list with a one-time notice', async () => {
    const board = makeBoard({ name: 'Old project' });
    const { router } = openBoard(board, {
      [`POST /boards/${board.id}/archive`]: ok({ ...board, isArchived: true }),
      'GET /boards?page=1&limit=100': okPage([]),
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for Old project' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive board' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Archive board' }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/boards'));
    expect((await screen.findByRole('status')).textContent).toContain(
      'Board “Old project” archived.',
    );
    await waitFor(() => expect(router.state.location.state).toBeNull());
  });

  it('stops showing the cached board once access is lost', async () => {
    const board = makeBoard({ name: 'Secret plans', currentUserRole: 'OWNER' });
    openBoard(board, {
      [`GET /boards/${board.id}`]: then(ok(board), fail(404, 'NOT_FOUND')),
    });
    await screen.findByRole('heading', { name: 'Secret plans' });

    refocusWindow();

    expect(
      await screen.findByRole('heading', { name: 'Board not found' }),
    ).toBeTruthy();
    expect(screen.queryByText('Secret plans')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
  });

  it('keeps the board on screen when a refresh fails for other reasons', async () => {
    const board = makeBoard({ name: 'Flaky network' });
    openBoard(board, {
      [`GET /boards/${board.id}`]: then(ok(board), fail(500, 'INTERNAL_ERROR')),
    });
    await screen.findByRole('heading', { name: 'Flaky network' });

    refocusWindow();

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Flaky network' }),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByRole('heading', { name: 'Board not found' }),
    ).toBeNull();
  });

  it('shows archived boards read-only', async () => {
    const board = makeBoard({
      name: 'Frozen',
      isArchived: true,
      currentUserRole: 'OWNER',
    });
    openBoard(board);

    expect(
      await screen.findByText(
        'This board is archived. It can be viewed but no longer changed.',
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Actions for Frozen' }),
    ).toBeNull();
  });
});
