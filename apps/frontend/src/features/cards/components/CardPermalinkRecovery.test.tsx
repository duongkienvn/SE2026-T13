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
  type MockResponse,
} from '../../../test/mock-api';
import { openPermalink } from '../../../test/permalink-fixtures';
import { renderApp } from '../../../test/render';

describe('permalink failure recovery', () => {
  it('keeps the placeholder draft when the first detail request fails, including after retry', async () => {
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id });
    const card = makeCard({ boardId: board.id, columnId: column.id });
    const path = `/boards/${board.id}`;
    let release: (reply: MockResponse) => void = () => undefined;
    let response = new Promise<MockResponse>((resolve) => {
      release = resolve;
    });
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${path}`]: ok(board),
      [`GET ${path}/columns?page=1&limit=100`]: okPage([column]),
      [`GET ${path}/cards?page=1&limit=100`]: okPage([card]),
      [`GET ${path}/members?page=1&limit=100`]: okPage([]),
      [`GET ${path}/cards/${card.id}`]: () => response,
      [`GET ${path}/cards/${card.id}/comments?page=1&limit=20`]: okPage([], {
        limit: 20,
      }),
    });
    renderApp(path);
    fireEvent.click(await screen.findByRole('button', { name: card.title }));
    const dialog = await screen.findByRole('dialog', { name: card.title });
    const description =
      within(dialog).getByLabelText<HTMLTextAreaElement>('Description');
    fireEvent.change(description, {
      target: { value: 'Draft while detail is pending' },
    });
    await act(async () => release(fail(503, 'UNAVAILABLE')));
    await waitFor(
      () =>
        expect(screen.getByRole('alert').textContent).toMatch(
          /couldn’t (load|refresh) this card/,
        ),
      { timeout: 7000 },
    );
    expect(screen.getByLabelText('Description')).toBe(description);
    expect(description.value).toBe('Draft while detail is pending');
    response = Promise.resolve(
      ok({ ...card, description: 'Remote description' }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.queryByText(/couldn’t refresh this card/)).toBeNull(),
    );
    expect(screen.getByLabelText('Description')).toBe(description);
    expect(description.value).toBe('Draft while detail is pending');
  }, 12000);

  it('does not mount or fetch a Card from cache until the new Board verification succeeds', async () => {
    const { router, path, cardPath, calls, refuseBoard, board } =
      openPermalink();
    await screen.findByRole('button', { name: 'Private card' });
    await act(() => router.navigate('/not-found-review'));
    calls.length = 0;
    refuseBoard(fail(503, 'UNAVAILABLE'));
    await act(() => router.navigate(cardPath));
    await waitFor(
      () => expect(calls.filter((call) => call.path === path)).toHaveLength(3),
      { timeout: 7000 },
    );
    expect(await screen.findByText("We couldn't load this board")).toBeTruthy();
    expect(calls.some((call) => call.path === cardPath)).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Private board')).toBeNull();
    expect(document.title).toBe('Board · Kanvexa');
    refuseBoard(ok(board));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('dialog', { name: 'Private card' });
    expect(calls.some((call) => call.path === cardPath)).toBe(true);
  }, 12000);
});
