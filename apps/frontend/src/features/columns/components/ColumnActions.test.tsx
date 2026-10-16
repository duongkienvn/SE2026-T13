import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Board } from '../../boards/types';
import {
  makeBoard,
  makeCard,
  makeColumn,
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
import type { Column } from '../types';

type Handler = MockResponse | (() => MockResponse | Promise<MockResponse>);

function openBoard(
  board: Board,
  columns: Handler,
  extra: Record<string, Handler> = {},
) {
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    [`GET /boards/${board.id}`]: ok(board),
    [`GET /boards/${board.id}/columns?page=1&limit=100`]: columns,
    [`GET /boards/${board.id}/cards?page=1&limit=100`]: okPage([]),
    [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
    ...extra,
  });
  renderApp(`/boards/${board.id}`);
  return calls;
}

/** The column list before and after a change. */
function sequence(before: Column[], after: Column[]) {
  let calls = 0;
  return () => okPage(calls++ === 0 ? before : after);
}

const writes = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.filter((c) => c.method !== 'GET');

describe('column actions', () => {
  it('adds the first column from the empty board, validating the name', async () => {
    const board = makeBoard();
    const created = makeColumn({ boardId: board.id, name: 'To Do' });
    let respond!: () => void;
    const calls = openBoard(board, sequence([], [created]), {
      [`POST /boards/${board.id}/columns`]: () =>
        new Promise<MockResponse>((resolve) => {
          respond = () => resolve(ok(created, 201));
        }),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Add column' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a column' });
    fireEvent.change(within(dialog).getByLabelText('Column name'), {
      target: { value: '   ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add column' }));
    expect(within(dialog).getByText('Enter a column name.')).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText('Column name'), {
      target: { value: '  To Do  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add column' }));
    // Pending: a second click does not send another request.
    const pending = await within(dialog).findByRole('button', {
      name: 'Adding…',
    });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(pending.closest('form')!);
    respond();

    expect(
      await screen.findByRole('heading', { name: 'To Do', level: 2 }),
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes(calls)).toEqual([
      expect.objectContaining({ method: 'POST', body: { name: 'To Do' } }),
    ]);
  });

  it('adds more columns from the tile after the last column', async () => {
    const board = makeBoard();
    const first = makeColumn({ boardId: board.id, name: 'Backlog' });
    openBoard(board, okPage([first]));

    await screen.findByRole('heading', { name: 'Backlog', level: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));

    expect(screen.getByRole('dialog', { name: 'Add a column' })).toBeTruthy();
  });

  it('shows the server’s validation message on the field', async () => {
    const board = makeBoard();
    openBoard(board, okPage([]), {
      [`POST /boards/${board.id}/columns`]: fail(
        400,
        'VALIDATION_FAILED',
        'Validation failed',
        ['name: name must be shorter than or equal to 120 characters'],
      ),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Add column' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Column name'), {
      target: { value: 'Long' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add column' }));

    expect(
      await within(dialog).findByText(
        'Column name must be shorter than or equal to 120 characters',
      ),
    ).toBeTruthy();
  });

  it('renames a column, keeping Save disabled until the name changes', async () => {
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id, name: 'Doing' });
    const calls = openBoard(
      board,
      sequence([column], [{ ...column, name: 'In Progress' }]),
      {
        [`PATCH /boards/${board.id}/columns/${column.id}`]: ok({
          ...column,
          name: 'In Progress',
        }),
      },
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for column Doing' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename column' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename column' });
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText('Column name'), {
      target: { value: 'In Progress' },
    });
    fireEvent.click(save);

    expect(
      await screen.findByRole('heading', { name: 'In Progress', level: 2 }),
    ).toBeTruthy();
    expect(writes(calls)).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        body: { name: 'In Progress' },
      }),
    ]);
  });

  it('only offers delete for columns without active cards', async () => {
    const board = makeBoard();
    const busy = makeColumn({ boardId: board.id, name: 'Busy' });
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([busy]),
      [`GET /boards/${board.id}/cards?page=1&limit=100`]: okPage([
        makeCard({ boardId: board.id, columnId: busy.id }),
      ]),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
    });
    renderApp(`/boards/${board.id}`);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for column Busy' }),
    );
    const item = screen.getByRole('button', { name: /^Delete column/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('Move or archive its cards first.');
    fireEvent.click(item);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('deletes an empty column after confirmation', async () => {
    const board = makeBoard();
    const keep = makeColumn({ boardId: board.id, name: 'Keep' });
    const old = makeColumn({ boardId: board.id, name: 'Old' });
    const calls = openBoard(board, sequence([keep, old], [keep]), {
      [`DELETE /boards/${board.id}/columns/${old.id}`]: { status: 204 },
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for column Old' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete column' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete “Old”?' });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete column' }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Old', level: 2 }),
      ).toBeNull(),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Keep', level: 2 }),
    ).toBeTruthy();
    expect(writes(calls).map((c) => c.method)).toEqual(['DELETE']);
  });

  it('explains when archived cards still block the delete', async () => {
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id, name: 'Looks empty' });
    openBoard(board, okPage([column]), {
      [`DELETE /boards/${board.id}/columns/${column.id}`]: fail(
        409,
        'COLUMN_NOT_EMPTY',
      ),
    });

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Actions for column Looks empty',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete column' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete column' }),
    );

    expect(
      await within(dialog).findByText(
        'This column still has cards (including archived ones), so it can’t be deleted.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Looks empty', level: 2 }),
    ).toBeTruthy();
  });

  it('refreshes the columns when the column was deleted meanwhile', async () => {
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id, name: 'Gone' });
    openBoard(board, sequence([column], []), {
      [`PATCH /boards/${board.id}/columns/${column.id}`]: fail(
        404,
        'COLUMN_NOT_FOUND',
      ),
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for column Gone' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename column' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Column name'), {
      target: { value: 'New name' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(
      await within(dialog).findByText(
        'This no longer exists, or you no longer have access to it.',
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Gone', level: 2 }),
      ).toBeNull(),
    );
  });

  it('hides every column action on an archived board', async () => {
    const board = makeBoard({ isArchived: true });
    openBoard(
      board,
      okPage([makeColumn({ boardId: board.id, name: 'Frozen' })]),
    );

    await screen.findByRole('heading', { name: 'Frozen', level: 2 });
    expect(screen.queryByRole('button', { name: 'Add column' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Actions for column Frozen' }),
    ).toBeNull();
  });

  it('has no Add column button on an empty archived board', async () => {
    openBoard(makeBoard({ isArchived: true }), okPage([]));

    await screen.findByRole('heading', { name: 'No columns yet' });
    expect(screen.queryByRole('button', { name: 'Add column' })).toBeNull();
  });

  it('turns read-only when the board was archived meanwhile', async () => {
    const board = makeBoard();
    let boardCalls = 0;
    openBoard(board, okPage([]), {
      [`GET /boards/${board.id}`]: () =>
        ok(boardCalls++ === 0 ? board : { ...board, isArchived: true }),
      [`POST /boards/${board.id}/columns`]: fail(409, 'BOARD_ARCHIVED'),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Add column' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Column name'), {
      target: { value: 'Late' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add column' }));

    expect(
      await within(dialog).findByText(
        'This board has been archived, so it can no longer be changed.',
      ),
    ).toBeTruthy();
    expect(
      await screen.findByText(
        'This board is archived. It can be viewed but no longer changed.',
      ),
    ).toBeTruthy();
  });
});
