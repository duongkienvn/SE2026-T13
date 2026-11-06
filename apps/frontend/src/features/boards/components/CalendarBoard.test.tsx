import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  makeBoard,
  makeCard,
  makeColumn,
  makeMember,
  okPage,
} from '../../../test/board-fixtures';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';
import { createdSockets, joined } from '../../../test/fake-socket';

describe('Calendar view', () => {
  it.each([500, 403])(
    'handles checklist HTTP %s without exposing stale items',
    async (status) => {
      storeSession();
      const board = makeBoard();
      const column = makeColumn({ boardId: board.id });
      const card = makeCard({
        boardId: board.id,
        columnId: column.id,
        title: 'Checklist access',
        dueDate: new Date().toISOString(),
      });
      let retried = false;
      mockApi({
        'GET /users/me': ok(testUser),
        [`GET /boards/${board.id}`]: ok(board),
        [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
        [`GET /boards/${board.id}/cards?page=1&limit=100`]: okPage([card]),
        [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
        [`GET /boards/${board.id}/cards/${card.id}/checklists`]: () =>
          retried
            ? ok({
                cardId: card.id,
                checklists: [],
                checkedItems: 0,
                totalItems: 0,
                completionPercentage: 0,
              })
            : fail(status, status === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR'),
      });
      renderApp(`/boards/${board.id}/calendar`);
      fireEvent.click(
        await screen.findByRole('button', { name: /Checklist access/ }),
      );
      const inspector = within(
        screen.getByRole('complementary', { name: 'Selected card' }),
      );
      if (status === 403) {
        await inspector.findByText('Checking card access…');
        expect(
          inspector.queryByRole('heading', { name: 'Checklist access' }),
        ).toBeNull();
      } else {
        await inspector.findByRole('alert', {}, { timeout: 5000 });
        retried = true;
        fireEvent.click(inspector.getByRole('button', { name: 'Retry' }));
        await inspector.findByText('No checklists');
      }
    },
  );
  it('loads real checklist items only on selection and keeps the inspector read-only', async () => {
    storeSession();
    const board = makeBoard({ isArchived: true });
    const column = makeColumn({ boardId: board.id });
    const member = makeMember();
    const card = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: 'Inspect release',
      description: 'Actual description',
      dueDate: new Date().toISOString(),
      assignees: [
        {
          userId: member.user.id,
          assignedById: null,
          createdAt: board.createdAt,
        },
      ],
    });
    const base = `/boards/${board.id}/cards/${card.id}/checklists`;
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
      [`GET /boards/${board.id}/cards?page=1&limit=100`]: okPage([card]),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([member]),
      [`GET ${base}`]: ok({
        cardId: card.id,
        checkedItems: 1,
        totalItems: 2,
        completionPercentage: 50,
        checklists: [
          {
            id: 'list',
            cardId: card.id,
            title: 'Release readiness',
            checkedItems: 1,
            totalItems: 2,
            completionPercentage: 50,
            items: [
              { id: 'one', text: 'Review notes', isChecked: true },
              { id: 'two', text: 'Publish notes', isChecked: false },
            ],
          },
        ],
      }),
    });
    renderApp(`/boards/${board.id}/calendar`);
    const pill = await screen.findByRole('button', { name: /Inspect release/ });
    expect(calls.some((call) => call.path === base)).toBe(false);
    fireEvent.click(pill);
    const inspector = within(
      screen.getByRole('complementary', { name: 'Selected card' }),
    );
    await inspector.findByText('Review notes');
    expect(inspector.getByText('Publish notes')).toBeTruthy();
    expect(inspector.getByText('Actual description')).toBeTruthy();
    expect(inspector.getByText(member.user.displayName)).toBeTruthy();
    expect(
      inspector
        .getByRole('progressbar', { name: 'Checklist Release readiness' })
        .getAttribute('aria-valuenow'),
    ).toBe('1');
    expect(inspector.queryByRole('checkbox')).toBeNull();
    expect(
      inspector
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Open card', 'Close inspector']);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).toBe(pill);
    expect(
      calls.filter(
        (call) => call.method !== 'GET' && call.path.includes('/checklists'),
      ),
    ).toHaveLength(0);
  });
  it.each(['archived', 'workspace viewer'] as const)(
    'shows %s cards without enabling edits',
    async (mode) => {
      storeSession();
      const board = makeBoard(
        mode === 'archived'
          ? { isArchived: true }
          : { currentUserRole: null, visibility: 'WORKSPACE_VISIBLE' },
      );
      const column = makeColumn({ boardId: board.id });
      const card = makeCard({
        boardId: board.id,
        columnId: column.id,
        title: 'Read-only card',
        dueDate: new Date().toISOString(),
      });
      const calls = mockApi({
        'GET /users/me': ok(testUser),
        [`GET /boards/${board.id}`]: ok(board),
        [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
        [`GET /boards/${board.id}/cards?page=1&limit=100`]: okPage([card]),
        [`GET /boards/${board.id}/cards/${card.id}`]: ok(card),
        [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      });
      renderApp(`/boards/${board.id}/calendar`);
      fireEvent.click(
        await screen.findByRole('button', { name: /Read-only card/ }),
      );
      fireEvent.click(
        within(
          screen.getByRole('complementary', { name: 'Selected card' }),
        ).getByRole('button', { name: 'Open card' }),
      );
      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).queryByRole('button', { name: 'Edit title' }),
      ).toBeNull();
      if (mode === 'workspace viewer')
        expect(calls.some((call) => call.path.includes('/members?'))).toBe(
          false,
        );
    },
  );
  it('refreshes cards on realtime updates and removes them after revocation', async () => {
    storeSession();
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id });
    const card = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: 'Private scheduled card',
      dueDate: new Date().toISOString(),
    });
    let listed: (typeof card)[] = [];
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
      [`GET /boards/${board.id}/cards?page=1&limit=100`]: () => okPage(listed),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
    });
    renderApp(`/boards/${board.id}/calendar`);
    await screen.findByRole('heading', { name: board.name });
    await waitFor(() => expect(createdSockets.length).toBeGreaterThan(0));
    const { socket } = createdSockets.at(-1)!;
    act(() => socket.open());
    await waitFor(() =>
      expect(socket.requests('board:join').length).toBeGreaterThan(0),
    );
    act(() => socket.lastJoin().reply(joined(board.id)));
    listed = [card];
    act(() =>
      socket.push('card:created', {
        boardId: board.id,
        cardId: card.id,
        columnId: column.id,
      }),
    );
    await screen.findByRole('button', { name: /Private scheduled card/ });
    act(() => socket.push('board:access-revoked', { boardId: board.id }));
    await screen.findByRole('heading', { name: 'Board not found' });
    expect(screen.queryByText('Private scheduled card')).toBeNull();
  });
  it('hides the calendar when card access is denied', async () => {
    storeSession();
    const board = makeBoard();
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([]),
      [`GET /boards/${board.id}/cards?page=1&limit=100`]: fail(
        403,
        'FORBIDDEN',
      ),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
    });
    renderApp(`/boards/${board.id}/calendar`);
    expect(await screen.findByText('Checking board access…')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Calendar' })).toBeNull();
  });

  it('opens overflow cards and returns to the selected calendar with filters', async () => {
    storeSession();
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id });
    const dueDate = new Date().toISOString();
    const cards = ['First', 'Second', 'Third'].map((title) =>
      makeCard({ boardId: board.id, columnId: column.id, title, dueDate }),
    );
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
      [`GET /boards/${board.id}/cards?page=1&limit=100&q=Card`]: okPage(cards),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      [`GET /boards/${board.id}/cards/${cards[2].id}`]: ok(cards[2]),
    });
    const { router } = renderApp(`/boards/${board.id}/calendar?q=Card`);
    const heading = await screen.findByRole('heading', {
      level: 2,
      name: /\w+ \d{4}/,
    });
    const initialMonth = heading.textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(heading.textContent).not.toBe(initialMonth);
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(heading.textContent).toBe(initialMonth);
    expect(router.state.location.search).toBe('?q=Card');
    const more = await screen.findByText('+1 more');
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('button', { name: /^Third/ }));
    const inspector = screen.getByRole('complementary', {
      name: 'Selected card',
    });
    expect(within(inspector).getByText('Third')).toBeTruthy();
    fireEvent.click(
      within(inspector).getByRole('button', { name: 'Open card' }),
    );
    expect(router.state.location.pathname).toBe(
      `/boards/${board.id}/cards/${cards[2].id}`,
    );
    expect(router.state.location.search).toBe('?q=Card');
    fireEvent.click(await screen.findByRole('button', { name: 'Close card' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/boards/${board.id}/calendar`,
      ),
    );
    expect(router.state.location.search).toBe('?q=Card');
    expect(
      screen.getByRole('complementary', { name: 'Selected card' }),
    ).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(
      screen.queryByRole('complementary', { name: 'Selected card' }),
    ).toBeNull();
  });
});
