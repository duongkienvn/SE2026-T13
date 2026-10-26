import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  makeBoard,
  makeCard,
  makeColumn,
  okPage,
} from '../../../test/board-fixtures';
import { mockApi, ok, storeSession, testUser } from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

describe.each([375, 1280])('card navigation at %ipx', (width) => {
  it('preserves board scroll and protects a draft when switching between two Card routes', async () => {
    vi.stubGlobal('innerWidth', width);
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: width >= 1024,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id });
    const first = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: 'First card',
    });
    const second = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: 'Second card',
    });
    const path = `/boards/${board.id}`;
    const firstPath = `${path}/cards/${first.id}`;
    const secondPath = `${path}/cards/${second.id}`;
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${path}`]: ok(board),
      [`GET ${path}/columns?page=1&limit=100`]: okPage([column]),
      [`GET ${path}/cards?page=1&limit=100`]: okPage([first, second]),
      [`GET ${path}/members?page=1&limit=100`]: okPage([]),
      [`GET ${firstPath}`]: ok(first),
      [`GET ${secondPath}`]: ok(second),
      [`GET ${firstPath}/comments?page=1&limit=20`]: okPage([], { limit: 20 }),
      [`GET ${secondPath}/comments?page=1&limit=20`]: okPage([], { limit: 20 }),
    });
    const { router } = renderApp(`${path}?filter=mine`);
    const opener = await screen.findByRole('button', { name: 'First card' });
    expect(
      screen.getByRole('button', {
        name: width === 375 ? 'Expand sidebar' : 'Collapse sidebar',
      }),
    ).toBeTruthy();
    const main = screen.getByRole('main');
    main.scrollTop = 120;
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'First card' });
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: 'Keep my draft' },
    });
    await act(() => router.navigate(secondPath));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Keep editing' }),
    );
    expect(router.state.location.pathname).toBe(firstPath);
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Description').value,
    ).toBe('Keep my draft');
    await act(() => router.navigate(secondPath));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Discard changes' }),
    );
    await screen.findByRole('dialog', { name: 'Second card' });
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Description').value,
    ).toBe('');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
    expect(screen.getByRole('main')).toBe(main);
    expect(main.scrollTop).toBe(120);
  });
});
