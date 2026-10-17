import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
  type MockResponse,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

const board = makeBoard({ name: 'Launch' });
const listPath = (resource: string, page = 1) =>
  `GET /boards/${board.id}/${resource}?page=${page}&limit=100`;

function openKanban(
  handlers: Record<string, MockResponse | (() => MockResponse)>,
) {
  storeSession();
  mockApi({
    'GET /users/me': ok(testUser),
    [`GET /boards/${board.id}`]: ok(board),
    [listPath('columns')]: okPage([]),
    [listPath('cards')]: okPage([]),
    [listPath('members')]: okPage([]),
    ...handlers,
  });
  renderApp(`/boards/${board.id}`);
}

const member = (id: string, displayName: string) =>
  makeMember({
    user: { id, displayName, email: `${id}@example.com`, avatarUrl: null },
    role: 'MEMBER',
  });

describe('KanbanBoard', () => {
  it('shows columns in position order with their active card counts', async () => {
    const done = makeColumn({ name: 'Done', position: '300.0000000000' });
    const todo = makeColumn({ name: 'To Do', position: '100.0000000000' });
    const doing = makeColumn({ name: 'Doing', position: '200.0000000000' });
    openKanban({
      [listPath('columns')]: okPage([done, todo, doing]),
      [listPath('cards')]: okPage([
        makeCard({ columnId: todo.id }),
        makeCard({ columnId: todo.id }),
        makeCard({ columnId: done.id }),
      ]),
    });

    const columns = await screen.findAllByRole('region');
    expect(columns.map((c) => c.getAttribute('aria-labelledby'))).toHaveLength(
      3,
    );
    expect(
      columns.map(
        (c) => within(c).getByRole('heading', { level: 2 }).textContent,
      ),
    ).toEqual(['To Do', 'Doing', 'Done']);
    expect(columns.map((c) => c.textContent)).toEqual([
      expect.stringContaining('To Do, 2 cards'),
      expect.stringContaining('Doing, 0 cards'),
      expect.stringContaining('Done, 1 card'),
    ]);
    expect(within(columns[1]).getByText('No cards yet')).toBeTruthy();
  });

  it('shows card title, description, due date and assignees', async () => {
    const column = makeColumn({ name: 'Backlog' });
    const later = makeCard({
      columnId: column.id,
      title: 'Feed research',
      description: 'Look at the best practices.',
      dueDate: '2999-04-24T12:00:00.000Z',
      assignees: [
        { userId: 'ada', assignedById: null, createdAt: '' },
        { userId: 'ghost', assignedById: null, createdAt: '' },
      ],
    });
    const late = makeCard({
      columnId: column.id,
      title: 'Old task',
      dueDate: '2000-01-01T12:00:00.000Z',
    });
    openKanban({
      [listPath('columns')]: okPage([column]),
      [listPath('cards')]: okPage([later, late]),
      [listPath('members')]: okPage([member('ada', 'Ada Lovelace')]),
    });

    const card = (
      await screen.findByRole('heading', { name: 'Feed research' })
    ).closest('article')!;
    expect(within(card).getByText('Look at the best practices.')).toBeTruthy();
    expect(card.querySelector('time')!.getAttribute('dateTime')).toBe(
      later.dueDate,
    );
    expect(within(card).queryByText(/Overdue/)).toBeNull();
    // Unknown users (no longer members) are left out.
    expect(
      await within(card).findByRole('list', {
        name: 'Assigned to Ada Lovelace',
      }),
    ).toBeTruthy();

    const overdue = screen
      .getByRole('heading', { name: 'Old task' })
      .closest('article')!;
    expect(within(overdue).getByText(/Overdue/)).toBeTruthy();
  });

  it('collapses more than three assignees into +N', async () => {
    const column = makeColumn();
    const ids = ['a', 'b', 'c', 'd', 'e'];
    openKanban({
      [listPath('columns')]: okPage([column]),
      [listPath('cards')]: okPage([
        makeCard({
          columnId: column.id,
          assignees: ids.map((userId) => ({
            userId,
            assignedById: null,
            createdAt: '',
          })),
        }),
      ]),
      [listPath('members')]: okPage(ids.map((id) => member(id, `User ${id}`))),
    });

    const list = await screen.findByRole('list', { name: /^Assigned to/ });
    // Three avatars plus "+2"; the label names everyone for screen readers.
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(list.querySelectorAll('li')).toHaveLength(4);
    expect(list.textContent).toContain('+2');
    expect(list.getAttribute('aria-label')).toBe(
      'Assigned to User a, User b, User c, User d, User e',
    );
  });

  it('loads every page of cards', async () => {
    const column = makeColumn();
    openKanban({
      [listPath('columns')]: okPage([column]),
      [listPath('cards')]: okPage(
        [makeCard({ columnId: column.id, title: 'One' })],
        {
          total: 101,
        },
      ),
      [listPath('cards', 2)]: okPage(
        [makeCard({ columnId: column.id, title: 'Two' })],
        { page: 2, total: 101 },
      ),
    });

    expect(await screen.findByRole('heading', { name: 'Two' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'One' })).toBeTruthy();
  });

  it('shows the board without avatars when members fail to load', async () => {
    const column = makeColumn({ name: 'Solo' });
    openKanban({
      [listPath('columns')]: okPage([column]),
      [listPath('cards')]: okPage([
        makeCard({
          columnId: column.id,
          title: 'Still here',
          assignees: [{ userId: 'ada', assignedById: null, createdAt: '' }],
        }),
      ]),
      [listPath('members')]: fail(500, 'INTERNAL_ERROR'),
    });

    expect(
      await screen.findByRole('heading', { name: 'Still here' }),
    ).toBeTruthy();
    expect(screen.queryByRole('list', { name: /^Assigned to/ })).toBeNull();
  });

  it('offers a retry when columns cannot be loaded', async () => {
    let calls = 0;
    const column = makeColumn({ name: 'Back again' });
    openKanban({
      [listPath('columns')]: () =>
        ++calls === 1 ? fail(400, 'BAD_REQUEST') : okPage([column]),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Back again' })).toBeTruthy(),
    );
  });

  it('offers keyboard drag grips only while the board can change', async () => {
    const column = makeColumn({ name: 'Doing' });
    openKanban({
      [listPath('columns')]: okPage([column]),
      [listPath('cards')]: okPage([
        makeCard({ columnId: column.id, title: 'Grab me' }),
      ]),
    });

    const grip = await screen.findByRole('button', {
      name: 'Move card Grab me',
    });
    expect(grip.getAttribute('aria-roledescription')).toBe('sortable');
    expect(
      screen.getByRole('button', { name: 'Move column Doing' }),
    ).toBeTruthy();
  });
});

describe('KanbanBoard on an archived board', () => {
  it('has no drag grips', async () => {
    storeSession();
    const archived = makeBoard({ isArchived: true });
    const column = makeColumn({ name: 'Frozen' });
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${archived.id}`]: ok(archived),
      [`GET /boards/${archived.id}/columns?page=1&limit=100`]: okPage([column]),
      [`GET /boards/${archived.id}/cards?page=1&limit=100`]: okPage([
        makeCard({ columnId: column.id, title: 'Stuck' }),
      ]),
      [`GET /boards/${archived.id}/members?page=1&limit=100`]: okPage([]),
    });
    renderApp(`/boards/${archived.id}`);

    await screen.findByRole('button', { name: 'Stuck' });
    expect(
      screen.queryByRole('button', { name: /^Move (card|column) / }),
    ).toBeNull();
  });
});
