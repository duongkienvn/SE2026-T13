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

function setup({ archivedBoard = false, error = false, pending = false } = {}) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const board = makeBoard({ isArchived: archivedBoard });
  const column = makeColumn({ boardId: board.id });
  const card = makeCard({
    boardId: board.id,
    columnId: column.id,
    title: 'Preserved archived card',
    isArchived: true,
    archivedAt: '2026-10-25T12:00:00Z',
  });
  let restored = false;
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    [`GET /boards/${board.id}`]: ok(board),
    [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
    [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
    [`GET /boards/${board.id}/cards?page=1&limit=100`]: () =>
      okPage(
        restored ? [{ ...card, isArchived: false, archivedAt: null }] : [],
      ),
    [`GET /boards/${board.id}/cards?status=archived&page=1&limit=20`]: () =>
      okPage(restored ? [] : [card], { limit: 20 }),
    [`POST /boards/${board.id}/cards/${card.id}/restore`]: async () => {
      if (pending) await gate;
      if (error) return fail(409, 'CARD_NOT_ARCHIVED');
      restored = true;
      return ok({ ...card, isArchived: false, archivedAt: null });
    },
  });
  renderApp(`/boards/${board.id}`);
  return { board, card, calls, release };
}

async function openArchive(name: string) {
  fireEvent.click(
    await screen.findByRole('button', { name: `Actions for ${name}` }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Archived cards' }));
  return screen.findByRole('dialog', { name: 'Archived cards' });
}

describe('Archived cards in board context', () => {
  it('submits once when two confirmation clicks arrive before a render', async () => {
    const { board, calls, release } = setup({ pending: true });
    const dialog = await openArchive(board.name);
    fireEvent.click(
      await within(dialog).findByRole('button', {
        name: 'Restore Preserved archived card',
      }),
    );
    const confirm = screen.getByRole('button', { name: 'Restore card' });
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    const count = calls.filter((call) => call.method === 'POST').length;
    release();
    expect(count).toBe(1);
    expect(
      await screen.findByText('Card “Preserved archived card” restored.'),
    ).toBeTruthy();
  });
  it('requires confirmation and restores only after server success', async () => {
    const { board, calls } = setup();
    const dialog = await openArchive(board.name);
    fireEvent.click(
      await within(dialog).findByRole('button', {
        name: 'Restore Preserved archived card',
      }),
    );
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Restore card' }));
    expect(
      await screen.findByText('Card “Preserved archived card” restored.'),
    ).toBeTruthy();
    expect(
      await screen.findByRole('heading', { name: 'No archived cards' }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1),
    );
  });

  it('keeps archived boards read-only while exposing the archived list', async () => {
    const { board } = setup({ archivedBoard: true });
    const dialog = await openArchive(board.name);
    expect(
      await within(dialog).findByText('Preserved archived card'),
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole('button', { name: /^Restore / }),
    ).toBeNull();
  });

  it('explains restore conflicts without a false success message', async () => {
    const { board } = setup({ error: true });
    const dialog = await openArchive(board.name);
    fireEvent.click(
      await within(dialog).findByRole('button', {
        name: 'Restore Preserved archived card',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restore card' }));
    expect(
      await screen.findByText(
        'This card was already restored. Refresh the list to see its current state.',
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText('Card “Preserved archived card” restored.'),
    ).toBeNull();
  });
});
