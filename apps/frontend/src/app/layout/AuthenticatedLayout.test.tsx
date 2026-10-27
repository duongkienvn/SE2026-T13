import { focusManager } from '@tanstack/react-query';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBoard, okPage } from '../../test/board-fixtures';
import { fail, mockApi, ok, storeSession, testUser } from '../../test/mock-api';
import { renderApp } from '../../test/render';

afterEach(() => {
  focusManager.setFocused(undefined);
  localStorage.removeItem('kanvexa.sidebar.expanded');
  vi.unstubAllGlobals();
});

describe('Authenticated navigation', () => {
  it('hides board navigation when the members request refuses access before the board refetches', async () => {
    const board = makeBoard({ name: 'Revoked board' });
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: fail(
        403,
        'FORBIDDEN',
      ),
    });
    renderApp(`/boards/${board.id}/members`);
    await screen.findByRole('heading', { name: 'Board not found' });
    expect(
      within(screen.getByRole('banner')).queryByRole('link', {
        name: board.name,
      }),
    ).toBeNull();
  });

  it('keeps Boards active across board routes, preserves the rail and keeps Profile in the account menu', async () => {
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
    const boardsLink = () => nav.getByRole('link', { name: 'Boards' });
    // Board-scoped and account destinations stay out of the global sidebar.
    expect(
      nav.queryByRole('link', { name: /Board members|Settings|Profile/ }),
    ).toBeNull();
    expect(boardsLink().getAttribute('aria-current')).toBe('page');
    fireEvent.click(nav.getByRole('button', { name: 'Collapse sidebar' }));
    fireEvent.click(screen.getByRole('link', { name: 'Alpha' }));
    await within(screen.getByRole('banner')).findByRole('link', {
      name: 'Alpha',
    });
    expect(boardsLink().getAttribute('aria-current')).toBe('page');
    await act(() => view.router.navigate(`/boards/${boards[1].id}/members`));
    const breadcrumb = within(
      await within(screen.getByRole('banner')).findByRole('navigation', {
        name: 'Breadcrumb',
      }),
    );
    await breadcrumb.findByRole('link', { name: 'Beta' });
    expect(
      breadcrumb.getByRole('link', { name: 'Boards' }).getAttribute('href'),
    ).toBe('/boards');
    expect(boardsLink().getAttribute('aria-current')).toBe('page');
    expect(nav.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: `Account menu for ${testUser.displayName}`,
      }),
    );
    fireEvent.click(screen.getByRole('link', { name: 'Profile' }));
    await screen.findByRole('heading', { name: 'Profile' });
    expect(boardsLink().getAttribute('aria-current')).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Connected accounts' }),
    ).toBeTruthy();
    expect(nav.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
    fireEvent.click(boardsLink());
    await screen.findByRole('link', { name: 'Alpha' });
    expect(view.router.state.location.pathname).toBe('/boards');
    view.unmount();
    renderApp('/boards');
    await screen.findByRole('link', { name: 'Alpha' });
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
  }, 15_000);

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
      await within(await screen.findByRole('banner')).findByRole('link', {
        name: board.name,
      });
      revoked = true;
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await screen.findByRole('heading', { name: 'Board not found' });
      expect(
        within(screen.getByRole('banner')).queryByRole('link', {
          name: board.name,
        }),
      ).toBeNull();
    },
  );

  it.each([403, 404])(
    'does not expose board context before a failed initial board load (%s)',
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
        within(screen.getByRole('banner')).queryByRole('navigation', {
          name: 'Breadcrumb',
        }),
      ).toBeNull();
      expect(screen.getByRole('link', { name: 'Boards' })).toBeTruthy();
    },
  );

  it('offers Profile and Log out from the mobile navigation drawer', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /auth/linked-providers': ok({
        googleLinked: false,
        hasPassword: true,
      }),
      'GET /boards?page=1&limit=100': okPage([]),
      'POST /auth/logout': ok(null),
    });
    const view = renderApp('/boards');
    const open = await screen.findByRole('button', { name: 'Open navigation' });
    fireEvent.click(open);
    let drawer = screen.getByRole('dialog', { name: 'Navigation menu' });
    expect(within(drawer).getByText(testUser.email)).toBeTruthy();
    fireEvent.click(within(drawer).getByRole('link', { name: 'Profile' }));
    await screen.findByRole('heading', { name: 'Profile' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    drawer = screen.getByRole('dialog', { name: 'Navigation menu' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Log out' }));
    await screen.findByRole('heading', { name: /sign in|log in|welcome/i });
    expect(view.router.state.location.pathname).toBe('/login');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
