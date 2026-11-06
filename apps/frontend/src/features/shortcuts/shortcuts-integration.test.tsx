import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  makeBoard,
  makeCard,
  makeColumn,
  okPage,
} from '../../test/board-fixtures';
import { fail, mockApi, ok, storeSession, testUser } from '../../test/mock-api';
import { renderApp } from '../../test/render';

afterEach(() => vi.restoreAllMocks());
describe('Board shortcuts integration', () => {
  it('skips collapsed Calendar overflow cards and includes them after expansion', async () => {
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({
      length: 1,
    } as DOMRectList);
    storeSession();
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id });
    const dueDate = new Date().toISOString();
    const cards = ['Alpha', 'Beta', 'Gamma'].map((title) =>
      makeCard({ boardId: board.id, columnId: column.id, title, dueDate }),
    );
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      [`GET /boards/${board.id}/cards?page=1&limit=100`]: okPage(cards),
      [`GET /boards/${board.id}/cards/${cards[2].id}`]: ok(cards[2]),
    });
    const { router } = renderApp(`/boards/${board.id}/calendar`);
    const alpha = await screen.findByRole('button', { name: /^Alpha/ });
    const beta = screen.getByRole('button', { name: /^Beta/ });
    fireEvent.keyDown(document, { key: 'j' });
    expect(document.activeElement).toBe(alpha);
    fireEvent.keyDown(document, { key: 'j' });
    expect(document.activeElement).toBe(beta);
    fireEvent.keyDown(document, { key: 'j' });
    expect(document.activeElement).toBe(beta);
    fireEvent.click(screen.getByText('+1 more'));
    const gamma = screen.getByRole('button', { name: /^Gamma/ });
    fireEvent.keyDown(document, { key: 'j' });
    expect(document.activeElement).toBe(gamma);
    fireEvent.keyDown(gamma, { key: 'Enter' });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/boards/${board.id}/cards/${cards[2].id}`,
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Close card' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/boards/${board.id}/calendar`,
      ),
    );
  });
  it('switches all three views with filter and background retained', async () => {
    storeSession();
    const board = makeBoard({ backgroundPreset: 'lake' });
    const base = `/boards/${board.id}/cards?page=1&limit=100&q=match`;
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      'GET /boards/background-presets': ok([
        { id: 'lake', kind: 'photo', value: 'lake' },
      ]),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([]),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      [`GET ${base}`]: okPage([]),
      [`GET ${base}&sortBy=title&sortDirection=asc`]: okPage([]),
    });
    const { router } = renderApp(`/boards/${board.id}?q=match`);
    const canvas = await screen.findByRole('region', {
      name: 'Kanban workspace',
    });
    await waitFor(() =>
      expect(canvas.getAttribute('style')).toContain(
        '/board-backgrounds/lake.jpg',
      ),
    );
    fireEvent.keyDown(document, { key: '2' });
    await screen.findByRole('region', { name: 'Calendar workspace' });
    expect(router.state.location.search).toBe('?q=match');
    fireEvent.keyDown(document, { key: '3' });
    const table = await screen.findByRole('region', {
      name: 'Table workspace',
    });
    expect(table.getAttribute('style')).toContain(
      '/board-backgrounds/lake.jpg',
    );
    fireEvent.keyDown(document, { key: '1' });
    await screen.findByRole('region', { name: 'Kanban workspace' });
    expect(router.state.location.search).toBe('?q=match');
  });

  it('moves focus in the Table and opens the focused Calendar card using Enter', async () => {
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({
      length: 1,
    } as DOMRectList);
    storeSession();
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id });
    const cards = ['Alpha', 'Beta'].map((title) =>
      makeCard({
        boardId: board.id,
        columnId: column.id,
        title,
        dueDate: new Date().toISOString(),
      }),
    );
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      [`GET /boards/${board.id}/cards?page=1&limit=100`]: okPage(cards),
      [`GET /boards/${board.id}/cards?page=1&limit=100&sortBy=title&sortDirection=asc`]:
        okPage(cards),
      [`GET /boards/${board.id}/cards/${cards[1].id}`]: ok(cards[1]),
    });
    const { router } = renderApp(`/boards/${board.id}/table`);
    await screen.findByRole('button', { name: 'Alpha' });
    fireEvent.keyDown(document, { key: 'j' });
    expect(document.activeElement?.textContent).toBe('Alpha');
    fireEvent.keyDown(document, { key: 'j' });
    expect(document.activeElement?.textContent).toBe('Beta');
    fireEvent.keyDown(document, { key: 'k' });
    expect(document.activeElement?.textContent).toBe('Alpha');
    fireEvent.keyDown(document, { key: '2' });
    await screen.findByRole('region', { name: 'Calendar workspace' });
    const beta = await screen.findByRole('button', { name: /^Beta/ });
    beta.focus();
    fireEvent.keyDown(beta, { key: 'Enter' });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/boards/${board.id}/cards/${cards[1].id}`,
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Close card' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/boards/${board.id}/calendar`,
      ),
    );
  });

  it('does not switch views when Board access is denied', async () => {
    storeSession();
    const board = makeBoard();
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: fail(403, 'FORBIDDEN'),
    });
    const { router } = renderApp(`/boards/${board.id}`);
    await screen.findByRole('heading', { name: 'Board not found' });
    fireEvent.keyDown(document, { key: '3' });
    expect(router.state.location.pathname).toBe(`/boards/${board.id}`);
  });

  it('does not navigate from a filter dialog and Escape closes it first', async () => {
    storeSession();
    const board = makeBoard();
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([]),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      [`GET /boards/${board.id}/cards?page=1&limit=100&sortBy=title&sortDirection=asc`]:
        okPage([]),
    });
    const { router } = renderApp(`/boards/${board.id}/table`);
    fireEvent.click(await screen.findByRole('button', { name: /Filter/ }));
    const dialog = screen.getByRole('dialog', { name: 'Filter cards' });
    fireEvent.keyDown(within(dialog).getByLabelText('Keyword'), { key: '?' });
    fireEvent.keyDown(document, { key: '2' });
    expect(router.state.location.pathname).toBe(`/boards/${board.id}/table`);
    act(() => fireEvent.keyDown(document, { key: 'Escape' }));
    expect(screen.queryByRole('dialog', { name: 'Filter cards' })).toBeNull();
    expect(document.activeElement?.textContent).toContain('Filter');
  });
});
