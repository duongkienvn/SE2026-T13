import { focusManager } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { makeBoard, okPage } from '../../test/board-fixtures';
import { fail, mockApi, ok, storeSession, testUser } from '../../test/mock-api';
import { renderApp } from '../../test/render';

afterEach(() => {
  focusManager.setFocused(undefined);
  localStorage.removeItem('kanvexa.sidebar.expanded');
});

describe('Authenticated navigation', () => {
  it('follows board context, preserves the rail and keeps Profile in the account menu', async () => {
    const boards = [makeBoard({ name: 'Alpha' }), makeBoard({ name: 'Beta' })];
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /auth/linked-providers': ok({
        googleLinked: true,
        hasPassword: true,
      }),
      'GET /boards?page=1&limit=100': okPage(boards),
      ...Object.fromEntries(
        boards.flatMap((board) => [
          [`GET /boards/${board.id}`, ok(board)],
          ...['columns', 'cards', 'members'].map((resource) => [
            `GET /boards/${board.id}/${resource}?page=1&limit=100`,
            okPage([]),
          ]),
        ]),
      ),
    });
    const view = renderApp('/boards');
    await screen.findByRole('link', { name: 'Alpha' });
    const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
    expect(
      nav.queryByRole('button', { name: /Board members|Settings|Profile/ }),
    ).toBeNull();
    fireEvent.click(nav.getByRole('button', { name: 'Collapse sidebar' }));
    fireEvent.click(screen.getByRole('link', { name: 'Alpha' }));
    await nav.findByRole('button', { name: 'Board members' });
    expect(
      nav.getByRole('button', { name: 'Boards' }).getAttribute('aria-current'),
    ).toBe('page');
    fireEvent.click(nav.getByRole('button', { name: 'Board members' }));
    await waitFor(() =>
      expect(view.router.state.location.pathname).toBe(
        `/boards/${boards[0].id}/members`,
      ),
    );
    expect(
      nav
        .getByRole('button', { name: 'Board members' })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(
      nav.getByRole('button', { name: 'Boards' }).getAttribute('aria-current'),
    ).toBeNull();
    await act(() => view.router.navigate(`/boards/${boards[1].id}`));
    await within(screen.getByRole('banner')).findByRole('link', {
      name: 'Beta',
    });
    fireEvent.click(nav.getByRole('button', { name: 'Board members' }));
    expect(view.router.state.location.pathname).toBe(
      `/boards/${boards[1].id}/members`,
    );
    expect(nav.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: `Account menu for ${testUser.displayName}`,
      }),
    );
    fireEvent.click(screen.getByRole('link', { name: 'Profile' }));
    await screen.findByRole('heading', { name: 'Profile', exact: true });
    expect(
      nav.queryByRole('button', { name: /Board members|Settings|Profile/ }),
    ).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Connected accounts' }),
    ).toBeTruthy();
    expect(nav.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
    fireEvent.click(nav.getByRole('button', { name: 'Boards' }));
    await screen.findByRole('link', { name: 'Alpha' });
    expect(view.router.state.location.pathname).toBe('/boards');
    view.unmount();
    renderApp('/boards');
    await screen.findByRole('link', { name: 'Alpha' });
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
  });

  it.each([403, 404])(
    'hides board navigation when access is revoked (%s), even with cached data',
    async (status) => {
      const board = makeBoard({ name: 'Private board' });
      let revoked = false;
      storeSession();
      mockApi({
        'GET /users/me': ok(testUser),
        [`GET /boards/${board.id}`]: () =>
          revoked ? fail(status, 'NOT_FOUND') : ok(board),
        ...Object.fromEntries(
          ['columns', 'cards', 'members'].map((resource) => [
            `GET /boards/${board.id}/${resource}?page=1&limit=100`,
            okPage([]),
          ]),
        ),
      });
      renderApp(`/boards/${board.id}`);
      await screen.findByRole('button', { name: 'Board members' });
      revoked = true;
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await screen.findByRole('heading', { name: 'Board not found' });
      expect(
        screen.queryByRole('button', { name: 'Board members' }),
      ).toBeNull();
      expect(
        within(screen.getByRole('banner')).queryByRole('link', {
          name: board.name,
        }),
      ).toBeNull();
    },
  );

  it.each([403, 404])(
    'does not expose Members before a failed initial board load (%s)',
    async (status) => {
      const board = makeBoard();
      storeSession();
      mockApi({
        'GET /users/me': ok(testUser),
        [`GET /boards/${board.id}`]: fail(status, 'NOT_FOUND'),
      });
      renderApp(`/boards/${board.id}`);
      await screen.findByRole('heading', { name: 'Board not found' });
      expect(
        screen.queryByRole('button', { name: /Board members/ }),
      ).toBeNull();
      expect(screen.getByRole('button', { name: 'Boards' })).toBeTruthy();
    },
  );
});
