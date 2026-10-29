import { focusManager } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Board } from '../../boards/types';
import { makeBoard, makeMember, okPage } from '../../../test/board-fixtures';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';
import type { BoardMember } from '../types';

type Handler = MockResponse | (() => MockResponse);

const grace = {
  id: '00000000-0000-4000-8000-000000000002',
  email: 'grace@example.com',
  displayName: 'Grace Hopper',
  avatarUrl: null,
};
const alan = {
  id: '00000000-0000-4000-8000-000000000003',
  email: 'alan@example.com',
  displayName: 'Alan Turing',
  avatarUrl: null,
};

/** The signed-in test user created the board and is its only owner. */
// Joined at local noon, so the shown date doesn't depend on the time zone.
const me = makeMember({
  role: 'OWNER',
  joinedAt: new Date(2026, 9, 1, 12).toISOString(),
});
const graceMember = makeMember({ user: grace, role: 'MEMBER' });

function membersPath(board: Board) {
  return `/boards/${board.id}/members`;
}

/** The list request: the page asks for the largest page size, page by page. */
function membersListKey(board: Board, page = 1) {
  return `GET ${membersPath(board)}?page=${page}&limit=100`;
}

function openMembers(
  board: Board,
  members: BoardMember[] | Handler,
  extra: Record<string, Handler> = {},
) {
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    [`GET /boards/${board.id}`]: ok(board),
    [`GET /boards/${board.id}/policy-capabilities`]: ok({
      canInviteMembers: true,
      canChangeMembership: true,
      canChangeVisibility: true,
    }),
    [membersListKey(board)]: Array.isArray(members) ? okPage(members) : members,
    ...extra,
  });
  const view = renderApp(membersPath(board));
  return { calls, ...view };
}

/** Members handler that returns `before` first and `after` once refetched. */
function changes(before: BoardMember[], after: BoardMember[]): Handler {
  let calls = 0;
  return () => {
    calls += 1;
    return okPage(calls === 1 ? before : after);
  };
}

describe('BoardMembersPage (as OWNER)', () => {
  const board = makeBoard({ name: 'Design Team', currentUserRole: 'OWNER' });

  it('honors separate Workspace policies for invitations and membership changes', async () => {
    openMembers(board, [me, graceMember], {
      [`GET /boards/${board.id}/policy-capabilities`]: ok({
        canInviteMembers: false,
        canChangeMembership: true,
        canChangeVisibility: true,
      }),
    });
    expect(
      await screen.findByRole('button', { name: 'Actions for Grace Hopper' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add member' })).toBeNull();
  });

  it('hides membership actions when only Board invitations are allowed', async () => {
    openMembers(board, [me, graceMember], {
      [`GET /boards/${board.id}/policy-capabilities`]: ok({
        canInviteMembers: true,
        canChangeMembership: false,
        canChangeVisibility: true,
      }),
    });
    expect(
      await screen.findByRole('button', { name: 'Add member' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
  });

  it('does not show management controls if policy capability cannot be loaded', async () => {
    openMembers(board, [me, graceMember], {
      [`GET /boards/${board.id}/policy-capabilities`]: fail(
        500,
        'INTERNAL_ERROR',
      ),
    });
    expect(await screen.findByRole('table')).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Add member' })).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
  });

  it('splits a long member list into numbered pages', async () => {
    // Without layout (jsdom) a page holds the fallback of 8 rows.
    const others = Array.from({ length: 9 }, (_, index) =>
      makeMember({
        user: {
          id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
          email: `person${index + 1}@example.com`,
          displayName: `Person ${index + 1}`,
          avatarUrl: null,
        },
        role: 'MEMBER',
      }),
    );
    const { router } = openMembers(board, [me, ...others]);

    const table = await screen.findByRole('table', {
      name: 'Members of Design Team',
    });
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 8);

    fireEvent.click(
      within(
        screen.getByRole('navigation', { name: 'Members pages' }),
      ).getByRole('button', { name: 'Page 2' }),
    );

    await waitFor(() =>
      expect(within(table).getAllByRole('row')).toHaveLength(1 + 2),
    );
    expect(within(table).getByText('Person 9')).toBeTruthy();
    expect(router.state.location.search).toBe('?page=2');
  });

  it('lists members with role and join date, owners first', async () => {
    openMembers(board, [graceMember, me]);

    const table = await screen.findByRole('table', {
      name: 'Members of Design Team',
    });
    const rows = within(table).getAllByRole('row').slice(1);
    // Owners first: the signed-in owner, then the member.
    expect(rows[0].textContent).toContain(`${testUser.displayName}(you)`);
    expect(rows[1].textContent).toContain('Grace Hopper');
    // Role column (a duplicate chip under the email is shown only on phones).
    expect(within(rows[0]).getAllByRole('cell')[1].textContent).toBe('Owner');
    expect(within(rows[1]).getAllByRole('cell')[1].textContent).toBe('Member');
    expect(within(rows[0]).getByText('Oct 1, 2026')).toBeTruthy();
    expect(document.title).toBe('Members · Design Team · Kanvexa');
  });

  it('keeps Boards active in the sidebar, since members are board-contextual', async () => {
    openMembers(board, [me]);
    const nav = await screen.findByRole('navigation', { name: 'Primary' });
    await waitFor(() =>
      expect(
        within(nav)
          .getByRole('link', { name: 'Boards' })
          .getAttribute('aria-current'),
      ).toBe('page'),
    );
    expect(within(nav).queryByRole('link', { name: /members/i })).toBeNull();
  });

  it('adds a registered user by email and refreshes the list', async () => {
    const { calls } = openMembers(board, changes([me], [me, graceMember]), {
      [`POST ${membersPath(board)}`]: ok(graceMember, 201),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Add member' }));
    const dialog = screen.getByRole('dialog', { name: 'Add member' });
    fireEvent.change(within(dialog).getByLabelText('Email address'), {
      target: { value: '  Grace@Example.com ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add member' }));

    expect((await screen.findByRole('status')).textContent).toContain(
      'grace@example.com was added to the board.',
    );
    expect(calls.find((call) => call.method === 'POST')!.body).toEqual({
      email: 'grace@example.com',
    });
    expect(await screen.findByText('Grace Hopper')).toBeTruthy();
  });

  it.each([
    [404, 'NOT_FOUND', 'No registered user has this email address.'],
    [409, 'CONFLICT', 'This person is already a member of this board.'],
  ])('explains a %s when adding', async (status, code, message) => {
    openMembers(board, [me], {
      [`POST ${membersPath(board)}`]: fail(status, code),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Add member' }));
    const dialog = screen.getByRole('dialog');
    const email = within(dialog).getByLabelText('Email address');
    fireEvent.change(email, { target: { value: 'someone@example.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add member' }));

    expect(await within(dialog).findByText(message)).toBeTruthy();
    expect(document.activeElement).toBe(email);
  });

  it('clears an add-member error once the email is edited', async () => {
    openMembers(board, [me], {
      [`POST ${membersPath(board)}`]: fail(404, 'NOT_FOUND'),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Add member' }));
    const dialog = screen.getByRole('dialog');
    const email = within(dialog).getByLabelText('Email address');
    fireEvent.change(email, { target: { value: 'nobody@example.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add member' }));
    await within(dialog).findByText(
      'No registered user has this email address.',
    );

    fireEvent.change(email, { target: { value: 'grace@example.com' } });

    expect(
      within(dialog).queryByText('No registered user has this email address.'),
    ).toBeNull();
    expect(email.getAttribute('aria-invalid')).not.toBe('true');
  });

  it('does not call an archived board a duplicate member', async () => {
    openMembers(board, [me], {
      [`POST ${membersPath(board)}`]: fail(409, 'BOARD_ARCHIVED'),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Add member' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Email address'), {
      target: { value: 'someone@example.com' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add member' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'This board has been archived, so it can no longer be changed.',
    );
    expect(within(dialog).queryByText(/already a member/)).toBeNull();
  });

  it('starts every add-member dialog with an empty form', async () => {
    openMembers(board, [me]);

    fireEvent.click(await screen.findByRole('button', { name: 'Add member' }));
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'draft@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

    expect(
      (screen.getByLabelText('Email address') as HTMLInputElement).value,
    ).toBe('');
  });

  it('promotes a member to owner', async () => {
    const { calls } = openMembers(
      board,
      changes([me, graceMember], [me, { ...graceMember, role: 'OWNER' }]),
      {
        [`PATCH ${membersPath(board)}/${grace.id}`]: ok({
          ...graceMember,
          role: 'OWNER',
        }),
      },
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for Grace Hopper' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Make owner' }));

    expect((await screen.findByRole('status')).textContent).toContain(
      'Grace Hopper is now an owner.',
    );
    expect(calls.find((call) => call.method === 'PATCH')!.body).toEqual({
      role: 'OWNER',
    });
  });

  it('shows the server message when a role change is refused', async () => {
    const coOwner = makeMember({ user: alan, role: 'OWNER' });
    openMembers(board, [me, coOwner], {
      [`PATCH ${membersPath(board)}/${alan.id}`]: fail(
        409,
        'LAST_OWNER',
        'A board must keep at least one owner.',
      ),
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for Alan Turing' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Make member' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'A board must keep at least one owner.',
    );
  });

  it('blocks removing or demoting the board creator, with a reason', async () => {
    openMembers(board, [me, makeMember({ user: alan, role: 'OWNER' })]);

    fireEvent.click(
      await screen.findByRole('button', {
        name: `Actions for ${testUser.displayName}`,
      }),
    );
    const remove = screen.getByRole('button', { name: /Remove from board/ });
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(remove.textContent).toContain('The board creator can’t be removed.');
    fireEvent.click(remove);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen
        .getByRole('button', { name: /Make member/ })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('removes a member after confirmation', async () => {
    const { calls } = openMembers(board, changes([me, graceMember], [me]), {
      [`DELETE ${membersPath(board)}/${grace.id}`]: { status: 204 },
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for Grace Hopper' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove from board' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove Grace Hopper?' });
    expect(dialog.textContent).toContain('card assignments');

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remove member' }),
    );

    expect((await screen.findByRole('status')).textContent).toContain(
      'Grace Hopper was removed from the board.',
    );
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
    await waitFor(() => expect(screen.queryByText('Grace Hopper')).toBeNull());
  });

  it('stops an owner removing or demoting themself, with a reason', async () => {
    const shared = makeBoard({
      name: 'Shared',
      currentUserRole: 'OWNER',
      createdById: alan.id,
    });
    openMembers(shared, [makeMember({ user: alan, role: 'OWNER' }), me]);

    fireEvent.click(
      await screen.findByRole('button', {
        name: `Actions for ${testUser.displayName}`,
      }),
    );
    expect(screen.queryByRole('button', { name: /Leave board/ })).toBeNull();
    const remove = screen.getByRole('button', { name: /Remove from board/ });
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(remove.textContent).toContain(
      'You can’t remove yourself from the board.',
    );
    fireEvent.click(remove);
    expect(screen.queryByRole('dialog')).toBeNull();
    const demote = screen.getByRole('button', { name: /Make member/ });
    expect(demote.getAttribute('aria-disabled')).toBe('true');
    expect(demote.textContent).toContain('You can’t change your own role.');
  });

  it('loads every page of a long member list', async () => {
    // 101 members at 100 per page: the second page holds the last one.
    const { calls } = openMembers(board, okPage([me], { total: 101 }), {
      [membersListKey(board, 2)]: okPage([graceMember], {
        page: 2,
        total: 101,
      }),
    });

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 2);
    expect(
      calls.filter((call) => call.path.startsWith(membersPath(board))),
    ).toHaveLength(2);
  });

  it('filters members by name or email', async () => {
    openMembers(board, [me, graceMember]);
    const search = await screen.findByRole('searchbox', {
      name: 'Search members',
    });

    fireEvent.change(search, { target: { value: 'GRACE@' } });

    const table = screen.getByRole('table');
    expect(within(table).getByText('Grace Hopper')).toBeTruthy();
    expect(within(table).queryByText(testUser.displayName)).toBeNull();
  });
});

describe('BoardMembersPage (as MEMBER)', () => {
  it('shows the list without any management controls', async () => {
    const board = makeBoard({
      currentUserRole: 'MEMBER',
      createdById: alan.id,
    });
    openMembers(board, [
      makeMember({ user: alan, role: 'OWNER' }),
      makeMember({ role: 'MEMBER' }),
    ]);

    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add member' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();
  });
});

describe('BoardMembersPage (archived board)', () => {
  it('says the board is read-only and hides management controls', async () => {
    const board = makeBoard({ currentUserRole: 'OWNER', isArchived: true });
    openMembers(board, [me, graceMember]);

    expect(
      await screen.findByText(
        'This board is archived. It can be viewed but no longer changed.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add member' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
  });
});

describe('BoardMembersPage errors', () => {
  afterEach(() => focusManager.setFocused(undefined));

  it('stops showing cached members once access is lost', async () => {
    const board = makeBoard({ name: 'Secret plans', currentUserRole: 'OWNER' });
    let boardCalls = 0;
    openMembers(board, [me, graceMember], {
      [`GET /boards/${board.id}`]: () =>
        boardCalls++ === 0 ? ok(board) : fail(404, 'NOT_FOUND'),
    });
    await screen.findByRole('table');

    // Returning to the tab refetches; the board is no longer accessible.
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    expect(
      await screen.findByRole('heading', { name: 'Board not found' }),
    ).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add member' })).toBeNull();
    expect(screen.queryByText('Secret plans')).toBeNull();
  });

  it.each(['/boards/abc', '/boards/abc/members'])(
    'sends anonymous visitors from %s to login without requesting board data',
    async (path) => {
      const calls = mockApi({});
      const { router } = renderApp(path);

      await waitFor(() =>
        expect(router.state.location.pathname).toBe('/login'),
      );
      expect(calls).toHaveLength(0);
    },
  );

  it('ends the session when board data returns 401', async () => {
    const board = makeBoard();
    const { router } = openMembers(board, fail(401, 'UNAUTHORIZED'), {
      [`GET /boards/${board.id}`]: fail(401, 'UNAUTHORIZED'),
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(localStorage.getItem('kanban.session')).toBeNull();
  });

  it('shows "Board not found" when access is denied', async () => {
    const board = makeBoard();
    openMembers(board, fail(403, 'FORBIDDEN'), {
      [`GET /boards/${board.id}`]: fail(403, 'FORBIDDEN'),
    });

    expect(
      await screen.findByRole('heading', { name: 'Board not found' }),
    ).toBeTruthy();
  });
});

describe('BoardMembersPage edge cases', () => {
  const board = makeBoard({ name: 'Edge', currentUserRole: 'OWNER' });

  it('keeps an active search clearable when the list shrinks', async () => {
    openMembers(board, changes([me, graceMember], [me]), {
      [`DELETE ${membersPath(board)}/${grace.id}`]: { status: 204 },
    });
    fireEvent.change(
      await screen.findByRole('searchbox', { name: 'Search members' }),
      { target: { value: 'grace' } },
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Actions for Grace Hopper' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove from board' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Remove member',
      }),
    );
    await screen.findByRole('heading', { name: 'No matching members' });

    const search = screen.getByRole('searchbox', { name: 'Search members' });
    fireEvent.change(search, { target: { value: '' } });
    expect(
      await within(screen.getByRole('main')).findByText(testUser.displayName),
    ).toBeTruthy();
  });

  it('switches to read-only when the board was archived meanwhile', async () => {
    let boardRequests = 0;
    openMembers(board, [me, graceMember], {
      [`GET /boards/${board.id}`]: () => {
        boardRequests += 1;
        return ok(boardRequests === 1 ? board : { ...board, isArchived: true });
      },
      [`PATCH ${membersPath(board)}/${grace.id}`]: fail(
        409,
        'BOARD_ARCHIVED',
        'Archived boards cannot be modified',
      ),
    });

    fireEvent.click(
      await screen.findByRole('button', { name: 'Actions for Grace Hopper' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Make owner' }));

    // The refusal refreshes the board, whose archived notice replaces the error.
    expect(
      await screen.findByText(
        'This board is archived. It can be viewed but no longer changed.',
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Add member' })).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
  });

  it('sends one role change at a time', async () => {
    let release: () => void = () => undefined;
    const { calls } = openMembers(board, [me, graceMember], {
      [`PATCH ${membersPath(board)}/${grace.id}`]: () =>
        new Promise((resolve) => {
          release = () => resolve(ok({ ...graceMember, role: 'OWNER' }));
        }) as unknown as MockResponse,
    });

    const actions = await screen.findByRole('button', {
      name: 'Actions for Grace Hopper',
    });
    fireEvent.click(actions);
    fireEvent.click(screen.getByRole('button', { name: 'Make owner' }));
    // The first request is now in flight; a second attempt must be ignored.
    await waitFor(() =>
      expect(calls.some((call) => call.method === 'PATCH')).toBe(true),
    );
    fireEvent.click(actions);
    fireEvent.click(screen.getByRole('button', { name: 'Make owner' }));

    release();
    expect(
      await screen.findByText('Grace Hopper is now an owner.'),
    ).toBeTruthy();
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });
});
