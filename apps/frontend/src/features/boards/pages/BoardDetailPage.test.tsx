import { focusManager } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Board } from '../types';
import { makeActivity, makeBoard, okPage } from '../../../test/board-fixtures';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';
import {
  workspacePage,
  workspaceResponse,
} from '../../../test/workspace-fixtures';
import { createdSockets } from '../../../test/fake-socket';

function openBoard(board: Board, extra: Parameters<typeof mockApi>[0] = {}) {
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    [`GET /boards/${board.id}`]: ok(board),
    [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([]),
    [`GET /boards/${board.id}/cards?page=1&limit=100`]: okPage([]),
    [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
    ...extra,
  });
  const view = renderApp(`/boards/${board.id}`);
  return { calls, ...view };
}

/** Returns `first` once, then `after` for every refetch. */
function then(first: MockResponse, after: MockResponse) {
  let calls = 0;
  return () => (calls++ === 0 ? first : after);
}

/** Simulates returning to the tab, which refetches stale queries. */
function refocusWindow() {
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
}

afterEach(() => focusManager.setFocused(undefined));

describe('BoardDetailPage', () => {
  it('renders a Workspace-only viewer without membership details or write controls', async () => {
    const board = makeBoard({
      name: 'Workspace view',
      currentUserRole: null,
      visibility: 'WORKSPACE_VISIBLE',
    });
    const { calls } = openBoard(board, {
      [`GET /boards/${board.id}/activities?page=1&limit=8`]: okPage([]),
    });
    const main = within(await screen.findByRole('main'));
    await main.findByRole('heading', { name: 'Workspace view' });
    await main.findByRole('heading', { name: 'No columns yet' });
    expect(main.getByText('Read only')).toBeTruthy();
    expect(main.queryByRole('link', { name: 'Members' })).toBeNull();
    expect(main.queryByRole('button', { name: 'Add column' })).toBeNull();
    fireEvent.click(main.getByRole('button', { name: 'Activity' }));
    await screen.findByRole('dialog', { name: 'Activity' });
    await screen.findByRole('heading', { name: 'No activity yet' });
    expect(calls.some((call) => call.path.includes('/members'))).toBe(false);
  });
  it('shows the board with role, members link and tab title', async () => {
    const board = makeBoard({
      name: 'Product Development',
      description: 'From idea to launch.',
      currentUserRole: 'MEMBER',
    });
    openBoard(board);

    const main = within(await screen.findByRole('main'));
    expect(
      await main.findByRole('heading', { name: 'Product Development' }),
    ).toBeTruthy();
    expect(main.getByText('From idea to launch.')).toBeTruthy();
    expect(main.getByText('Member')).toBeTruthy();
    expect(
      main.getByRole('link', { name: 'Members' }).getAttribute('href'),
    ).toBe(`/boards/${board.id}/members`);
    expect(
      await main.findByRole('heading', { name: 'No columns yet' }),
    ).toBeTruthy();
    expect(document.title).toBe('Product Development · Kanvexa');
  });

  it('shows the board name in the header and opens Members from the board page', async () => {
    const board = makeBoard({ name: 'Design Team' });
    const { router } = openBoard(board);

    const header = await screen.findByRole('banner');
    expect(
      await within(header).findByRole('link', { name: 'Design Team' }),
    ).toBeTruthy();

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(
      within(nav)
        .getByRole('link', { name: 'Boards' })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(within(nav).queryByRole('link', { name: /members/i })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Members' }));
    expect(router.state.location.pathname).toBe(`/boards/${board.id}/members`);
  });

  it('keeps board-scoped links out of the global sidebar', async () => {
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /boards?page=1&limit=100': okPage([]),
    });
    renderApp('/boards');

    const nav = await screen.findByRole('navigation', { name: 'Primary' });
    expect(within(nav).queryByRole('link', { name: /members/i })).toBeNull();
  });

  it('offers edit and archive to owners only', async () => {
    const owned = makeBoard({ name: 'Mine', currentUserRole: 'OWNER' });
    openBoard(owned);
    expect(
      await screen.findByRole('button', { name: 'Actions for Mine' }),
    ).toBeTruthy();
  });

  it('hides owner actions from members', async () => {
    const shared = makeBoard({ name: 'Theirs', currentUserRole: 'MEMBER' });
    openBoard(shared);
    await screen.findByRole('heading', { name: 'Theirs' });
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Theirs' }));
    expect(screen.getByRole('button', { name: 'Archived cards' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit board' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive board' })).toBeNull();
  });

  it.each([
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
  ])(
    'treats %s the same: board not found or no access',
    async (status, code) => {
      const board = makeBoard();
      openBoard(board, { [`GET /boards/${board.id}`]: fail(status, code) });

      expect(
        await screen.findByRole('heading', { name: 'Board not found' }),
      ).toBeTruthy();
      expect(
        screen
          .getByRole('link', { name: 'Back to boards' })
          .getAttribute('href'),
      ).toBe('/boards');
      // No empty board-name slot (or stray divider) in the header.
      const header = screen.getByRole('banner');
      expect(
        within(header).queryByRole('navigation', { name: 'Breadcrumb' }),
      ).toBeNull();
      expect(header.querySelector('.bg-line')).toBeNull();
    },
  );

  it('archives, then returns to the boards list with a one-time notice', async () => {
    const board = makeBoard({ name: 'Old project' });
    const { router } = openBoard(board, {
      [`POST /boards/${board.id}/archive`]: ok({ ...board, isArchived: true }),
      'GET /boards?page=1&limit=100': okPage([]),
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for Old project' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive board' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Archive board' }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/boards'));
    expect((await screen.findByRole('status')).textContent).toContain(
      'Board “Old project” archived.',
    );
    await waitFor(() => expect(router.state.location.state).toBeNull());
  });

  it('stops showing the cached board once access is lost', async () => {
    const board = makeBoard({ name: 'Secret plans', currentUserRole: 'OWNER' });
    openBoard(board, {
      [`GET /boards/${board.id}`]: then(ok(board), fail(404, 'NOT_FOUND')),
    });
    await screen.findByRole('heading', { name: 'Secret plans' });

    refocusWindow();

    expect(
      await screen.findByRole('heading', { name: 'Board not found' }),
    ).toBeTruthy();
    expect(screen.queryByText('Secret plans')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
  });

  it('stops showing the board once its cards are no longer available', async () => {
    const board = makeBoard({ name: 'Secret plans', currentUserRole: 'OWNER' });
    let boardCalls = 0;
    openBoard(board, {
      // Loads, survives the refocus refresh, then is gone when asked again.
      [`GET /boards/${board.id}`]: () =>
        ++boardCalls <= 2 ? ok(board) : fail(404, 'NOT_FOUND'),
      [`GET /boards/${board.id}/cards?page=1&limit=100`]: then(
        okPage([]),
        fail(403, 'FORBIDDEN'),
      ),
    });
    await screen.findByRole('heading', { name: 'Secret plans' });

    refocusWindow();

    expect(
      await screen.findByRole('heading', { name: 'Board not found' }),
    ).toBeTruthy();
    expect(boardCalls).toBe(3);
    expect(screen.queryByText('Secret plans')).toBeNull();
  });

  it('keeps the board on screen when a refresh fails for other reasons', async () => {
    const board = makeBoard({ name: 'Flaky network' });
    openBoard(board, {
      [`GET /boards/${board.id}`]: then(ok(board), fail(500, 'INTERNAL_ERROR')),
    });
    await screen.findByRole('heading', { name: 'Flaky network' });

    refocusWindow();

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Flaky network' }),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByRole('heading', { name: 'Board not found' }),
    ).toBeNull();
  });

  it('shows archived boards read-only', async () => {
    const board = makeBoard({
      name: 'Frozen',
      isArchived: true,
      currentUserRole: 'OWNER',
    });
    openBoard(board);

    expect(
      await screen.findByText(
        'This board is archived. It can be viewed but no longer changed.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Frozen' }));
    expect(screen.getByRole('button', { name: 'Restore board' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit board' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add column' })).toBeNull();
  });
});

describe('Board Detail OWNER visibility and move', () => {
  const destination = workspaceResponse;
  const owner = (overrides: Partial<Board> = {}) =>
    makeBoard({
      name: 'Guest owned board',
      workspaceId: 'source-not-joined',
      visibility: 'PRIVATE',
      capabilities: {
        canReadBoard: true,
        canWriteBoard: true,
        canManageBoard: true,
        canManageMembers: true,
        canRestoreBoard: false,
      },
      ...overrides,
    });
  const policy = (allowed = true) =>
    ok({
      canInviteMembers: true,
      canChangeMembership: true,
      canChangeVisibility: allowed,
    });
  const setup = (board: Board, extra: Parameters<typeof mockApi>[0] = {}) =>
    openBoard(board, {
      [`GET /boards/${board.id}/policy-capabilities`]: policy(),
      'GET /workspaces?page=1&limit=100': workspacePage(
        [destination],
        1,
        1,
        100,
      ),
      ...extra,
    });
  async function openAction(board: Board, action: string) {
    fireEvent.click(
      await screen.findByRole('button', { name: `Actions for ${board.name}` }),
    );
    const button = screen.getByRole('button', {
      name: new RegExp(`^${action}`),
    });
    await waitFor(() =>
      expect(button.getAttribute('aria-disabled')).toBeNull(),
    );
    fireEvent.click(button);
    return screen.findByRole('dialog');
  }
  async function chooseWorkspace(dialog: HTMLElement) {
    const radio = within(dialog).getByRole('radio', { name: /Workspace/ });
    await waitFor(() => expect(radio.matches(':disabled')).toBe(false));
    fireEvent.click(radio);
  }
  async function chooseDestination(dialog: HTMLElement) {
    await within(dialog).findByRole('option', { name: destination.name });
    fireEvent.change(within(dialog).getByRole('combobox'), {
      target: { value: destination.id },
    });
  }
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  it('lets a Guest OWNER open both shared dialogs without reading source Workspace data, and restores focus', async () => {
    const board = owner();
    const { calls } = setup(board);
    const dialog = await openAction(board, 'Change visibility');
    await chooseWorkspace(dialog);
    expect(dialog.textContent).toContain('read-only');
    expect(dialog.textContent).toContain('columns, cards and comments');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: `Actions for ${board.name}` }),
    );
    const move = await openAction(board, 'Move to workspace');
    await chooseDestination(move);
    expect(move.textContent).toContain('The board link stays the same.');
    expect(move.textContent).toContain(
      'People added to the board keep their access.',
    );
    expect(move.textContent).toContain('Visibility resets to Private.');
    expect(
      calls.some((c) => c.path.startsWith(`/workspaces/${board.workspaceId}`)),
    ).toBe(false);
  });

  it.each([
    { currentUserRole: 'MEMBER' as const },
    { currentUserRole: null },
    { isArchived: true },
    {
      capabilities: {
        canReadBoard: true,
        canWriteBoard: true,
        canManageBoard: false,
        canManageMembers: false,
        canRestoreBoard: false,
      },
    },
    { capabilities: undefined },
  ])(
    'hides new actions without active explicit OWNER authority: %j',
    async (overrides) => {
      const board = owner(overrides);
      setup(board);
      fireEvent.click(
        await screen.findByRole('button', {
          name: `Actions for ${board.name}`,
        }),
      );
      expect(
        screen.queryByRole('button', { name: 'Change visibility' }),
      ).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Move to workspace' }),
      ).toBeNull();
      expect(
        screen.getByRole('button', { name: 'Archived cards' }),
      ).toBeTruthy();
      if (board.isArchived)
        expect(
          screen.getByRole('button', { name: 'Restore board' }),
        ).toBeTruthy();
    },
  );

  it('disables visibility by effective policy while keeping Move independent', async () => {
    const board = owner();
    const { calls } = setup(board, {
      [`GET /boards/${board.id}/policy-capabilities`]: policy(false),
    });
    fireEvent.click(
      await screen.findByRole('button', { name: `Actions for ${board.name}` }),
    );
    await screen.findByText('Workspace rules do not allow visibility changes.');
    fireEvent.click(screen.getByRole('button', { name: /Change visibility/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Move to workspace' }));
    await chooseDestination(await screen.findByRole('dialog'));
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('rechecks policy when opening the dialog and fails closed on a changed policy', async () => {
    const board = owner();
    setup(board, {
      [`GET /boards/${board.id}/policy-capabilities`]: then(
        policy(),
        policy(false),
      ),
    });
    const dialog = await openAction(board, 'Change visibility');
    await within(dialog).findByText(
      /does not let board owners change visibility/,
    );
    expect(
      within(dialog)
        .getByRole('radio', { name: /Workspace/ })
        .matches(':disabled'),
    ).toBe(true);
  });

  it('filters joined destinations and excludes the current Workspace', async () => {
    const board = owner();
    setup(board, {
      'GET /workspaces?page=1&limit=100': workspacePage(
        [
          { ...destination, id: board.workspaceId, name: 'Current' },
          destination,
          {
            ...destination,
            id: 'locked',
            name: 'Locked',
            canCreateBoards: false,
          },
        ],
        1,
        3,
        100,
      ),
    });
    const dialog = await openAction(board, 'Move to workspace');
    await within(dialog).findByRole('option', { name: destination.name });
    expect(
      within(dialog).queryByRole('option', { name: 'Current' }),
    ).toBeNull();
    expect(within(dialog).queryByRole('option', { name: 'Locked' })).toBeNull();
  });

  it('shows an honest empty destination state', async () => {
    const board = owner();
    setup(board, {
      'GET /workspaces?page=1&limit=100': workspacePage([], 1, 0, 100),
    });
    const dialog = await openAction(board, 'Move to workspace');
    await within(dialog).findByText(/No eligible destination workspace/);
    expect(
      (
        within(dialog).getByRole('button', {
          name: 'Move board',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('explains lost implicit access when returning a board to Private', async () => {
    const board = owner({ visibility: 'WORKSPACE_VISIBLE' });
    const { calls } = setup(board, {
      [`PATCH /boards/${board.id}/visibility`]: ok({
        ...board,
        visibility: 'PRIVATE',
      }),
    });
    const dialog = await openAction(board, 'Change visibility');
    const radio = within(dialog).getByRole('radio', { name: /Private/ });
    await waitFor(() => expect(radio.matches(':disabled')).toBe(false));
    fireEvent.click(radio);
    expect(dialog.textContent).toContain('will lose their read-only access');
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      visibility: 'PRIVATE',
    });
  });

  it('shows directory failure separately from an empty list and prevents moves', async () => {
    const board = owner();
    const { calls } = setup(board, {
      'GET /workspaces?page=1&limit=100': fail(403, 'FORBIDDEN'),
    });
    const dialog = await openAction(board, 'Move to workspace');
    await within(dialog).findByText(/Could not load your joined workspaces/);
    fireEvent.submit(dialog.querySelector('form')!);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(
      within(dialog).queryByText(/No eligible destination workspace/),
    ).toBeNull();
  });

  it('blocks a previously selected destination after its creation permission changes', async () => {
    const board = owner();
    let allowed = true;
    const { calls } = setup(board, {
      'GET /workspaces?page=1&limit=100': () =>
        workspacePage(
          [{ ...destination, canCreateBoards: allowed }],
          1,
          1,
          100,
        ),
    });
    const dialog = await openAction(board, 'Move to workspace');
    await chooseDestination(dialog);
    allowed = false;
    refocusWindow();
    await within(dialog).findByText(/No eligible destination workspace/);
    fireEvent.submit(dialog.querySelector('form')!);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('disables an open visibility form when policy is revoked', async () => {
    const board = owner();
    let allowed = true;
    const { calls } = setup(board, {
      [`GET /boards/${board.id}/policy-capabilities`]: () => policy(allowed),
    });
    const dialog = await openAction(board, 'Change visibility');
    await chooseWorkspace(dialog);
    allowed = false;
    refocusWindow();
    await within(dialog).findByText(
      /does not let board owners change visibility/,
    );
    fireEvent.submit(dialog.querySelector('form')!);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('purges an open dialog on realtime revocation and ignores a late response', async () => {
    const board = owner();
    let revoked = false;
    const pending = deferred<MockResponse>();
    setup(board, {
      [`GET /boards/${board.id}`]: () =>
        revoked ? fail(404, 'NOT_FOUND') : ok(board),
      [`POST /boards/${board.id}/move-workspace`]: () => pending.promise,
    });
    const dialog = await openAction(board, 'Move to workspace');
    await chooseDestination(dialog);
    fireEvent.submit(dialog.querySelector('form')!);
    await within(dialog).findByRole('button', { name: 'Moving…' });
    act(() => {
      revoked = true;
      createdSockets
        .at(-1)!
        .socket.push('board:access-revoked', { boardId: board.id });
    });
    await screen.findByRole('heading', { name: 'Board not found' });
    await act(async () => pending.resolve(ok(board)));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/^Board moved\./)).toBeNull();
    expect(screen.queryByRole('heading', { name: board.name })).toBeNull();
  });

  it.each(['visibility', 'move'] as const)(
    'sends the %s payload, prevents duplicate submits/closing and refreshes only after confirmation',
    async (action) => {
      const board = owner();
      let saved = board;
      const pending = deferred<MockResponse>();
      const endpoint =
        action === 'visibility' ? 'visibility' : 'move-workspace';
      const method = action === 'visibility' ? 'PATCH' : 'POST';
      const { calls, router } = setup(board, {
        [`GET /boards/${board.id}`]: () => ok(saved),
        [`${method} /boards/${board.id}/${endpoint}`]: () => pending.promise,
      });
      const dialog = await openAction(
        board,
        action === 'visibility' ? 'Change visibility' : 'Move to workspace',
      );
      if (action === 'visibility') await chooseWorkspace(dialog);
      else await chooseDestination(dialog);
      fireEvent.submit(dialog.querySelector('form')!);
      await within(dialog).findByRole('button', {
        name: action === 'visibility' ? 'Saving…' : 'Moving…',
      });
      fireEvent.submit(dialog.querySelector('form')!);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(
        screen.queryByText(
          action === 'visibility'
            ? 'Board visibility updated.'
            : /^Board moved\./,
        ),
      ).toBeNull();
      expect(calls.filter((c) => c.method === method)).toHaveLength(1);
      expect(calls.find((c) => c.method === method)?.body).toEqual(
        action === 'visibility'
          ? { visibility: 'WORKSPACE_VISIBLE' }
          : { destinationWorkspaceId: destination.id },
      );
      saved = {
        ...board,
        visibility: action === 'visibility' ? 'WORKSPACE_VISIBLE' : 'PRIVATE',
        workspaceId: action === 'move' ? destination.id : board.workspaceId,
      };
      await act(async () => pending.resolve(ok(saved)));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await screen.findByText(
        action === 'visibility'
          ? 'Board visibility updated.'
          : /^Board moved\./,
      );
      await waitFor(() =>
        expect(
          calls.filter((c) => c.path === `/boards/${board.id}`).length,
        ).toBeGreaterThan(1),
      );
      expect(router.state.location.pathname).toBe(`/boards/${board.id}`);
    },
  );

  it.each([403, 404, 409])(
    'handles a denied/conflicting %s mutation without success',
    async (status) => {
      const board = owner();
      setup(board, {
        [`POST /boards/${board.id}/move-workspace`]: fail(
          status,
          'DENIED',
          'private server details',
        ),
      });
      const dialog = await openAction(board, 'Move to workspace');
      await chooseDestination(dialog);
      fireEvent.submit(dialog.querySelector('form')!);
      if (status === 404)
        await screen.findByRole('heading', { name: 'Board not found' });
      else {
        await within(dialog).findByRole('alert');
        expect(
          (
            within(dialog).getByRole('button', {
              name: 'Move board',
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(true);
      }
      expect(document.body.textContent).not.toContain('private server details');
      expect(screen.queryByText(/^Board moved\./)).toBeNull();
    },
  );

  it.each([
    ['visibility', true],
    ['visibility', false],
    ['move', true],
    ['move', false],
  ] as const)(
    'completes %s after access:changed before REST (reload first: %s)',
    async (action, reloadFirst) => {
      const board = owner();
      const saved = {
        ...board,
        visibility:
          action === 'visibility'
            ? ('WORKSPACE_VISIBLE' as const)
            : ('PRIVATE' as const),
        workspaceId: action === 'move' ? destination.id : board.workspaceId,
      };
      const pending = deferred<MockResponse>();
      const recheck = deferred<MockResponse>();
      let resync = false;
      const method = action === 'visibility' ? 'PATCH' : 'POST';
      const { calls } = setup(board, {
        [`GET /boards/${board.id}`]: () =>
          resync ? recheck.promise : ok(board),
        [`${method} /boards/${board.id}/${action === 'visibility' ? 'visibility' : 'move-workspace'}`]:
          () => pending.promise,
      });
      const dialog = await openAction(
        board,
        action === 'visibility' ? 'Change visibility' : 'Move to workspace',
      );
      if (action === 'visibility') await chooseWorkspace(dialog);
      else await chooseDestination(dialog);
      fireEvent.submit(dialog.querySelector('form')!);
      const pendingLabel = action === 'visibility' ? 'Saving…' : 'Moving…';
      await within(dialog).findByRole('button', { name: pendingLabel });
      act(() => {
        resync = true;
        createdSockets.at(-1)!.socket.push('access:changed', {});
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      if (reloadFirst) {
        await act(async () => recheck.resolve(ok(saved)));
        const reopened = await screen.findByRole('dialog');
        expect(
          within(reopened).getByRole('button', { name: pendingLabel }),
        ).toBeTruthy();
        fireEvent.submit(reopened.querySelector('form')!);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.getByRole('dialog')).toBeTruthy();
      }
      await act(async () => pending.resolve(ok(saved)));
      if (!reloadFirst) {
        expect(
          screen.queryByText(/Board visibility updated\.|^Board moved\./),
        ).toBeNull();
        await act(async () => recheck.resolve(ok(saved)));
      }
      await screen.findByText(
        action === 'visibility'
          ? 'Board visibility updated.'
          : /^Board moved\./,
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      refocusWindow();
      await screen.findByRole('heading', { name: board.name });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(calls.filter((c) => c.method === method)).toHaveLength(1);
    },
  );

  it.each(['revoked', 'role', 'session', 'denied-recheck'] as const)(
    'rejects late completion after access:changed followed by %s',
    async (transition) => {
      const board = owner();
      const pending = deferred<MockResponse>();
      let deny = false;
      setup(board, {
        [`GET /boards/${board.id}`]: () =>
          deny ? fail(403, 'FORBIDDEN') : ok(board),
        [`POST /boards/${board.id}/move-workspace`]: () => pending.promise,
      });
      const dialog = await openAction(board, 'Move to workspace');
      await chooseDestination(dialog);
      fireEvent.submit(dialog.querySelector('form')!);
      await within(dialog).findByRole('button', { name: 'Moving…' });
      act(() => createdSockets.at(-1)!.socket.push('access:changed', {}));
      await screen.findByRole('heading', { name: board.name });
      act(() => {
        if (transition === 'revoked')
          createdSockets
            .at(-1)!
            .socket.push('board:access-revoked', { boardId: board.id });
        if (transition === 'role')
          createdSockets.at(-1)!.socket.push('member:role-changed', {
            boardId: board.id,
            userId: testUser.id,
            role: 'MEMBER',
          });
        if (transition === 'session') {
          localStorage.removeItem('kanban.session');
          window.dispatchEvent(
            new StorageEvent('storage', { key: 'kanban.session' }),
          );
        }
        if (transition === 'denied-recheck') deny = true;
      });
      await act(async () => pending.resolve(ok(board)));
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Moving…' })).toBeNull(),
      );
      expect(screen.queryByText(/^Board moved\./)).toBeNull();
      if (transition === 'revoked' || transition === 'denied-recheck')
        await screen.findByRole('heading', { name: 'Board not found' });
    },
  );

  it.each(['role', 'archive', 'access'] as const)(
    'closes owner dialogs after a refreshed %s change and ignores late success',
    async (change) => {
      const board = owner();
      let response = ok(board);
      const pending = deferred<MockResponse>();
      setup(board, {
        [`GET /boards/${board.id}`]: () => response,
        [`POST /boards/${board.id}/move-workspace`]: () => pending.promise,
      });
      const dialog = await openAction(board, 'Move to workspace');
      await chooseDestination(dialog);
      fireEvent.submit(dialog.querySelector('form')!);
      await within(dialog).findByRole('button', { name: 'Moving…' });
      response =
        change === 'access'
          ? fail(404, 'NOT_FOUND')
          : ok({
              ...board,
              currentUserRole: change === 'role' ? 'MEMBER' : 'OWNER',
              isArchived: change === 'archive',
            });
      refocusWindow();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await act(async () => pending.resolve(ok(board)));
      expect(screen.queryByText(/^Board moved\./)).toBeNull();
    },
  );

  it.each(['logout', 'other-account', 'same-account'] as const)(
    'ignores late mutation completion after %s',
    async (change) => {
      const board = owner();
      const pending = deferred<MockResponse>();
      const { router } = setup(board, {
        [`POST /boards/${board.id}/move-workspace`]: () => pending.promise,
      });
      const dialog = await openAction(board, 'Move to workspace');
      await chooseDestination(dialog);
      fireEvent.submit(dialog.querySelector('form')!);
      await within(dialog).findByRole('button', { name: 'Moving…' });
      if (change !== 'logout')
        mockApi({
          'GET /users/me': ok({
            ...testUser,
            id: change === 'other-account' ? 'account-b' : testUser.id,
          }),
          [`GET /boards/${board.id}`]: fail(404, 'NOT_FOUND'),
          'GET /workspaces?page=1&limit=100': workspacePage([], 1, 0, 100),
        });
      await act(async () => {
        if (change === 'logout') localStorage.removeItem('kanban.session');
        else storeSession('replacement-token');
        window.dispatchEvent(
          new StorageEvent('storage', { key: 'kanban.session' }),
        );
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await act(async () => pending.resolve(ok(board)));
      expect(screen.queryByText(/^Board moved\./)).toBeNull();
      if (change === 'logout')
        expect(router.state.location.pathname).toBe('/login');
    },
  );

  it('rechecks authority again if access:changed interrupts the completion read', async () => {
    const board = owner();
    const pending = deferred<MockResponse>();
    const firstCheck = deferred<MockResponse>();
    let checks = 0;
    let resync = false;
    const { calls } = setup(board, {
      [`GET /boards/${board.id}`]: () => {
        if (!resync) return ok(board);
        return ++checks <= 2 ? firstCheck.promise : fail(403, 'FORBIDDEN');
      },
      [`POST /boards/${board.id}/move-workspace`]: () => pending.promise,
    });
    const dialog = await openAction(board, 'Move to workspace');
    await chooseDestination(dialog);
    fireEvent.submit(dialog.querySelector('form')!);
    await within(dialog).findByRole('button', { name: 'Moving…' });
    act(() => {
      resync = true;
      createdSockets.at(-1)!.socket.push('access:changed', {});
    });
    await waitFor(() => expect(checks).toBe(1));
    await act(async () => pending.resolve(ok(board)));
    await waitFor(() => expect(checks).toBe(2));
    act(() => createdSockets.at(-1)!.socket.push('access:changed', {}));
    await act(async () => firstCheck.resolve(ok(board)));
    await screen.findByRole('heading', { name: 'Board not found' });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(screen.queryByText(/^Board moved\./)).toBeNull();
  });

  it('does not deliver old completion into a different Board route or close its dialog', async () => {
    const board = owner();
    const other = owner({ name: 'Other board' });
    const pending = deferred<MockResponse>();
    const { router } = setup(board, {
      [`POST /boards/${board.id}/move-workspace`]: () => pending.promise,
      [`GET /boards/${other.id}`]: ok(other),
      [`GET /boards/${other.id}/columns?page=1&limit=100`]: okPage([]),
      [`GET /boards/${other.id}/cards?page=1&limit=100`]: okPage([]),
      [`GET /boards/${other.id}/members?page=1&limit=100`]: okPage([]),
      [`GET /boards/${other.id}/policy-capabilities`]: policy(),
    });
    const dialog = await openAction(board, 'Move to workspace');
    await chooseDestination(dialog);
    fireEvent.submit(dialog.querySelector('form')!);
    await within(dialog).findByRole('button', { name: 'Moving…' });
    await act(() => router.navigate(`/boards/${other.id}`));
    const next = await openAction(other, 'Change visibility');
    await chooseWorkspace(next);
    await act(async () => pending.resolve(ok(board)));
    expect(screen.getByRole('dialog')).toBe(next);
    expect(screen.queryByText(/^Board moved\./)).toBeNull();
  });

  it('ends an expired session on 401 without a success notice', async () => {
    const board = owner();
    const { router } = setup(board, {
      [`POST /boards/${board.id}/move-workspace`]: fail(401, 'UNAUTHORIZED'),
    });
    const dialog = await openAction(board, 'Move to workspace');
    await chooseDestination(dialog);
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(screen.queryByText(/^Board moved\./)).toBeNull();
  });
});

describe('BoardDetailPage activity history', () => {
  const activities = (boardId: string) =>
    `GET /boards/${boardId}/activities?page=1&limit=8`;

  it('opens the history from the header and returns focus on close', async () => {
    const board = makeBoard({ name: 'Roadmap', currentUserRole: 'MEMBER' });
    const { calls } = openBoard(board, {
      [activities(board.id)]: okPage(
        [makeActivity({ boardId: board.id, actionType: 'CARD_CREATED' })],
        { limit: 8 },
      ),
    });
    await screen.findByRole('heading', { name: 'Roadmap' });
    expect(calls.some((call) => call.path.includes('/activities'))).toBe(false);

    const trigger = screen.getByRole('button', { name: 'Activity' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Activity' });
    await waitFor(() =>
      expect(dialog.textContent).toContain('You created a card'),
    );
    expect(
      calls.filter((call) => call.path.includes('/activities')).length,
    ).toBe(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    // The board itself is still there.
    expect(screen.getByRole('heading', { name: 'Roadmap' })).toBeTruthy();
  });

  it('keeps history readable on archived boards', async () => {
    const board = makeBoard({ name: 'Frozen', isArchived: true });
    openBoard(board, {
      [activities(board.id)]: okPage(
        [makeActivity({ boardId: board.id, actionType: 'CARD_ARCHIVED' })],
        { limit: 8 },
      ),
    });
    await screen.findByRole('heading', { name: 'Frozen' });

    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    const dialog = await screen.findByRole('dialog', { name: 'Activity' });
    await waitFor(() =>
      expect(dialog.textContent).toContain('You archived a card'),
    );
  });

  it('closes the history when access to the board is lost', async () => {
    const board = makeBoard({ name: 'Secret plans', currentUserRole: 'OWNER' });
    openBoard(board, {
      [`GET /boards/${board.id}`]: then(ok(board), fail(404, 'NOT_FOUND')),
      [activities(board.id)]: okPage(
        [makeActivity({ boardId: board.id, actionType: 'COLUMN_CREATED' })],
        { limit: 8 },
      ),
    });
    await screen.findByRole('heading', { name: 'Secret plans' });
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    const dialog = await screen.findByRole('dialog', { name: 'Activity' });
    await waitFor(() =>
      expect(dialog.textContent).toContain('created a column'),
    );

    refocusWindow();

    expect(
      await screen.findByRole('heading', { name: 'Board not found' }),
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/created a column/)).toBeNull();
  });
});
