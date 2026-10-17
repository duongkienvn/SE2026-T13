import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BoardMember } from '../../board-members/types';
import type { Board } from '../../boards/types';
import type { Column } from '../../columns/types';
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
  type MockRequest,
  type MockResponse,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';
import { dueDateFromInput } from '../validation';
import type { Card } from '../types';

type Handler =
  | MockResponse
  | ((request: MockRequest) => MockResponse | Promise<MockResponse>);

interface Setup {
  board?: Board;
  columns?: Column[];
  cards?: Card[] | Handler;
  members?: BoardMember[];
  extra?: Record<string, Handler>;
}

function openBoard({
  board = makeBoard(),
  columns = [],
  cards = [],
  members = [],
  extra = {},
}: Setup) {
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    [`GET /boards/${board.id}`]: ok(board),
    [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage(columns),
    [`GET /boards/${board.id}/cards?page=1&limit=100`]: Array.isArray(cards)
      ? okPage(cards)
      : cards,
    [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage(members),
    // Card Detail now fetches comments independently of card edits/assignees.
    ...Object.fromEntries(
      (Array.isArray(cards) ? cards : []).map((card) => [
        `GET /boards/${board.id}/cards/${card.id}/comments?page=1&limit=20`,
        okPage([], { limit: 20 }),
      ]),
    ),
    ...extra,
  });
  renderApp(`/boards/${board.id}`);
  return calls;
}

const writes = (calls: MockRequest[]) =>
  calls.filter((c) => c.method !== 'GET');

/** Answers with `first` once, then `after` for every refetch. */
function then<T>(first: T, after: T) {
  let count = 0;
  return () => okPage(count++ === 0 ? (first as never) : (after as never));
}

const person = (id: string, displayName: string) =>
  makeMember({
    user: { id, displayName, email: `${id}@example.com`, avatarUrl: null },
    role: 'MEMBER',
  });

async function openCard(title: string) {
  fireEvent.click(await screen.findByRole('button', { name: title }));
  return screen.findByRole('dialog', { name: title });
}

describe('adding cards', () => {
  it('adds cards from the bottom of a column and stays open for the next', async () => {
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id, name: 'Backlog' });
    const created = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: 'Write tests',
    });
    const calls = openBoard({
      board,
      columns: [column],
      cards: then([], [created]),
      extra: { [`POST /boards/${board.id}/cards`]: ok(created, 201) },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'New card' }));
    const input = screen.getByLabelText('Title of the new card in Backlog');
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('Enter a card title.');
    expect(writes(calls)).toHaveLength(0);

    fireEvent.change(input, { target: { value: '  Write tests  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // POST, then a list refetch: allow for a busy test run.
    expect(
      await screen.findByRole(
        'button',
        { name: 'Write tests' },
        { timeout: 3000 },
      ),
    ).toBeTruthy();
    expect(writes(calls)).toEqual([
      expect.objectContaining({
        method: 'POST',
        body: { columnId: column.id, title: 'Write tests' },
      }),
    ]);
    // Ready for the next card.
    expect(
      (
        screen.getByLabelText(
          'Title of the new card in Backlog',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe('');

    fireEvent.keyDown(
      screen.getByLabelText('Title of the new card in Backlog'),
      {
        key: 'Escape',
      },
    );
    expect(
      screen.queryByLabelText('Title of the new card in Backlog'),
    ).toBeNull();
  });

  it('opens the composer from the column header too', async () => {
    const column = makeColumn({ name: 'To Do' });
    openBoard({ columns: [column] });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Add a card to To Do' }),
    );

    expect(
      screen.getByLabelText('Title of the new card in To Do'),
    ).toBeTruthy();
  });

  it('offers no card changes on an archived board', async () => {
    const board = makeBoard({ isArchived: true });
    const column = makeColumn({ boardId: board.id, name: 'Frozen' });
    openBoard({
      board,
      columns: [column],
      cards: [
        makeCard({ boardId: board.id, columnId: column.id, title: 'Old' }),
      ],
    });

    const dialog = await openCard('Old');
    expect(screen.queryByRole('button', { name: 'New card' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Add a card to Frozen' }),
    ).toBeNull();
    for (const label of ['Title', 'Description', 'Due date']) {
      expect(
        (within(dialog).getByLabelText(label) as HTMLInputElement).disabled,
      ).toBe(true);
    }
    expect(
      within(dialog).queryByRole('button', { name: 'Save changes' }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole('button', { name: 'Archive card' }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole('button', { name: 'Add assignee' }),
    ).toBeNull();
  });
});

describe('card detail', () => {
  function setupCard(
    overrides: Partial<Card> = {},
    extra: (card: Card, path: string) => Record<string, Handler> = () => ({}),
  ) {
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id, name: 'Backlog' });
    const card = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: 'Feed research',
      description: 'Old notes',
      ...overrides,
    });
    const path = `/boards/${board.id}/cards/${card.id}`;
    const calls = openBoard({
      board,
      columns: [column],
      cards: [card],
      members: [person('ada', 'Ada Lovelace'), person('grace', 'Grace Hopper')],
      extra: { [`GET ${path}`]: ok(card), ...extra(card, path) },
    });
    return { board, card, calls, path };
  }

  it('shows the card with its column, keeping Save off until something changes', async () => {
    setupCard();
    const dialog = await openCard('Feed research');

    expect(within(dialog).getByText(/^In Backlog · Created/)).toBeTruthy();
    expect(
      (within(dialog).getByLabelText('Title') as HTMLInputElement).value,
    ).toBe('Feed research');
    expect(
      (within(dialog).getByLabelText('Description') as HTMLTextAreaElement)
        .value,
    ).toBe('Old notes');
    expect(
      (
        within(dialog).getByRole('button', {
          name: 'Save changes',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('sends only the changed fields, blank description as null', async () => {
    const { calls } = setupCard({}, (card, path) => ({
      [`PATCH ${path}`]: ok({
        ...card,
        title: 'Feed research v2',
        description: null,
        dueDate: dueDateFromInput('2026-10-25'),
      }),
    }));
    const dialog = await openCard('Feed research');

    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: ' Feed research v2 ' },
    });
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: '   ' },
    });
    fireEvent.change(within(dialog).getByLabelText('Due date'), {
      target: { value: '2026-10-25' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );

    expect(await within(dialog).findByText('Changes saved.')).toBeTruthy();
    expect(writes(calls)).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        body: {
          title: 'Feed research v2',
          description: null,
          dueDate: dueDateFromInput('2026-10-25'),
        },
      }),
    ]);
  });

  it('clears the due date with null and leaves other fields out', async () => {
    const dueDate = dueDateFromInput('2026-11-01');
    const { calls } = setupCard({ dueDate }, (card, path) => ({
      [`PATCH ${path}`]: ok({ ...card, dueDate: null }),
    }));
    const dialog = await openCard('Feed research');

    expect(
      (within(dialog).getByLabelText('Due date') as HTMLInputElement).value,
    ).toBe('2026-11-01');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Clear due date' }),
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );

    await within(dialog).findByText('Changes saved.');
    expect(writes(calls)[0].body).toEqual({ dueDate: null });
  });

  it('validates the title before saving', async () => {
    const { calls } = setupCard();
    const dialog = await openCard('Feed research');

    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: '  ' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );

    expect(within(dialog).getByText('Enter a card title.')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
  });

  it('assigns only board members not yet assigned, then removes them', async () => {
    const assigned = {
      userId: 'ada',
      assignedById: testUser.id,
      createdAt: '2026-10-17T00:00:00.000Z',
    };
    let detail = 0;
    const { calls } = setupCard({}, (card, path) => ({
      [`GET ${path}`]: () =>
        ok(detail++ === 1 ? { ...card, assignees: [assigned] } : card),
      [`GET ${path}/comments?page=1&limit=20`]: okPage([], { limit: 20 }),
      [`POST ${path}/assignees`]: ok(assigned, 201),
      [`DELETE ${path}/assignees/ada`]: { status: 204 },
    }));
    const dialog = await openCard('Feed research');

    expect(within(dialog).getByText('No one is assigned.')).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add assignee' }),
    );
    const picker = within(dialog).getByRole('list', { name: 'Board members' });
    expect(within(picker).getAllByRole('button')).toEqual([
      within(picker).getByRole('button', { name: 'Assign Ada Lovelace' }),
      within(picker).getByRole('button', { name: 'Assign Grace Hopper' }),
    ]);
    fireEvent.click(
      within(picker).getByRole('button', { name: 'Assign Ada Lovelace' }),
    );

    await within(dialog).findByRole('button', {
      name: 'Remove Ada Lovelace',
    });
    expect(writes(calls)[0]).toMatchObject({
      method: 'POST',
      body: { userId: 'ada' },
    });
    // Ada is no longer offered.
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add assignee' }),
    );
    expect(within(dialog).getAllByRole('button', { name: /^Assign / })).toEqual(
      [within(dialog).getByRole('button', { name: 'Assign Grace Hopper' })],
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remove Ada Lovelace' }),
    );

    await waitFor(() =>
      expect(writes(calls).map((c) => c.method)).toEqual(['POST', 'DELETE']),
    );
  });

  it('explains when the picked person has left the board', async () => {
    setupCard({}, (_card, path) => ({
      [`POST ${path}/assignees`]: fail(404, 'BOARD_MEMBER_NOT_FOUND'),
    }));
    const dialog = await openCard('Feed research');

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Add assignee' }),
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Assign Grace Hopper' }),
    );

    expect(
      await within(dialog).findByText(
        'This person is no longer a member of the board.',
      ),
    ).toBeTruthy();
  });

  it('archives after confirming, closing the dialog and dropping the card', async () => {
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id });
    const card = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: 'Done thing',
    });
    const path = `/boards/${board.id}/cards/${card.id}`;
    const calls = openBoard({
      board,
      columns: [column],
      cards: then([card], []),
      extra: {
        [`GET ${path}`]: ok(card),
        [`POST ${path}/archive`]: ok({ ...card, isArchived: true }),
      },
    });
    const dialog = await openCard('Done thing');

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Archive card' }),
    );
    const confirm = within(dialog).getByRole('group', { name: 'Archive card' });
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(
      within(confirm).getByRole('button', { name: 'Archive card' }),
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Done thing' })).toBeNull(),
    );
    expect(writes(calls).map((c) => c.path)).toEqual([`${path}/archive`]);
  });

  it('shows an archived card read-only', async () => {
    // The detail reports it archived (by someone else) after it was listed.
    setupCard({}, (card, path) => ({
      [`GET ${path}`]: ok({ ...card, isArchived: true }),
    }));
    const dialog = await openCard('Feed research');

    expect(
      await within(dialog).findByText(
        'This card is archived. It can be viewed but no longer changed.',
      ),
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole('button', { name: 'Save changes' }),
    ).toBeNull();
  });

  it('says so when the card no longer exists', async () => {
    setupCard({}, (_card, path) => ({
      [`GET ${path}`]: fail(404, 'CARD_NOT_FOUND'),
    }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Feed research' }),
    );

    expect(
      await screen.findByText(
        'This card no longer exists, or you no longer have access to it.',
      ),
    ).toBeTruthy();
  });
});
