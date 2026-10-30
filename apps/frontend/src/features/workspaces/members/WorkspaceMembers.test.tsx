import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { flushSync } from 'react-dom';
import { describe, expect, it } from 'vitest';
import { routes } from '../../../app/routes';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../../test/mock-api';
import {
  workspaceOverviewResponse,
  workspacePage,
  workspaceResponse,
} from '../../../test/workspace-fixtures';
import { AuthProvider } from '../../auth/AuthProvider';
import { RealtimeProvider } from '../../realtime/RealtimeProvider';
import type { WorkspaceResponse } from '../response';
import { workspaceKeys } from '../query-keys';
import type { WorkspaceInvitation, WorkspaceMember } from './types';

const admin: WorkspaceResponse = {
  ...workspaceResponse,
  role: 'ADMIN',
  canManage: true,
};
const id = admin.id;
const base = `/workspaces/${id}`;
const membersPath = `GET ${base}/members?page=1&limit=10`;
const invitationsPath = `GET ${base}/invitations?page=1&limit=10`;

function member(
  name: string,
  role: 'ADMIN' | 'MEMBER',
  userId = `user-${name.split(' ')[0].toLowerCase()}`,
): WorkspaceMember {
  return {
    userId,
    displayName: name,
    avatarUrl: null,
    avatarRevision: 0,
    role,
    joinedAt: '2026-10-01T00:00:00.000Z',
  };
}
const self = member('Ada Lovelace', 'ADMIN', testUser.id);
const grace = member('Grace Hopper', 'MEMBER');
const linus = member('Linus Torvalds', 'ADMIN');

function invitation(
  patch: Partial<WorkspaceInvitation> = {},
): WorkspaceInvitation {
  return {
    id: 'invite-1',
    workspaceId: id,
    email: 'new@example.com',
    role: 'MEMBER',
    status: 'PENDING',
    sendState: 'SENT',
    invitedById: testUser.id,
    expiresAt: '2026-11-05T00:00:00.000Z',
    createdAt: '2026-10-29T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
    consumedAt: null,
    revokedAt: null,
    ...patch,
  };
}

function mount(
  path = `${base}/members`,
  overrides: Parameters<typeof mockApi>[0] = {},
  workspace: WorkspaceResponse = admin,
) {
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    'GET /workspaces?page=1&limit=100': workspacePage([workspace], 1, 1, 100),
    [`GET ${base}/overview`]: ok({ ...workspaceOverviewResponse, workspace }),
    [membersPath]: workspacePage([self, grace, linus], 1, 3, 10),
    [invitationsPath]: workspacePage([invitation()], 1, 1, 10),
    ...overrides,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RealtimeProvider>
          <RouterProvider
            router={router}
            flushSync={(callback) => {
              flushSync(callback);
            }}
          />
        </RealtimeProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { calls, client, router };
}

const table = () => screen.findByRole('table', { name: /Members of/ });
const actions = async (name: string) => {
  fireEvent.click(
    await screen.findByRole('button', { name: `Actions for ${name}` }),
  );
};

describe('Workspace Members page', () => {
  it('lists real members for an ADMIN without emails or guessed counts', async () => {
    const { calls } = mount();
    const rows = within(await table()).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[1].textContent).toContain('Ada Lovelace(you)');
    expect(rows[2].textContent).toContain('Member');
    expect(within(await table()).queryByText(/@example\.com/)).toBeNull();
    expect(screen.getByText('3 members')).toBeTruthy();
    // No actions on your own row; the server owns self-changes.
    expect(
      screen.queryByRole('button', { name: 'Actions for Ada Lovelace' }),
    ).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: 'Invite Member',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(calls.some((call) => call.path.includes('/invitations'))).toBe(
      false,
    );
    const sections = screen.getByRole('navigation', {
      name: 'Workspace sections',
    });
    expect(
      within(sections)
        .getByRole('link', { name: 'Members' })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('sends search and role filters to the server', async () => {
    const { calls } = mount(`${base}/members`, {
      [`GET ${base}/members?page=1&limit=10&search=grace`]: workspacePage(
        [grace],
        1,
        1,
        10,
      ),
      [`GET ${base}/members?page=1&limit=10&search=grace&role=MEMBER`]:
        workspacePage([grace], 1, 1, 10),
    });
    await table();
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search members' }),
      {
        target: { value: 'grace' },
      },
    );
    await waitFor(() =>
      expect(screen.getByText('1 member matching these filters')).toBeTruthy(),
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by role' }), {
      target: { value: 'MEMBER' },
    });
    await waitFor(() =>
      expect(calls.some((call) => call.path.endsWith('&role=MEMBER'))).toBe(
        true,
      ),
    );
  });

  it('promotes after confirmation and refreshes from the server', async () => {
    let promoted = false;
    const { calls } = mount(`${base}/members`, {
      [membersPath]: () =>
        workspacePage(
          [self, { ...grace, role: promoted ? 'ADMIN' : 'MEMBER' }, linus],
          1,
          3,
          10,
        ),
      [`PATCH ${base}/members/${grace.userId}`]: () => {
        promoted = true;
        return ok({ ...grace, role: 'ADMIN' });
      },
    });
    await actions('Grace Hopper');
    fireEvent.click(screen.getByRole('button', { name: 'Make admin' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Make Grace Hopper an admin?',
    });
    // Nothing changes before confirmation.
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make admin' }));
    expect(
      await screen.findByText('Grace Hopper is now an admin.'),
    ).toBeTruthy();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      role: 'ADMIN',
    });
    await waitFor(() =>
      expect(
        within(screen.getAllByRole('row')[2]).queryAllByText('Admin'),
      ).not.toHaveLength(0),
    );
  });

  it('shows the last-ADMIN refusal and reloads the roster', async () => {
    let reads = 0;
    mount(`${base}/members`, {
      [membersPath]: () => {
        reads += 1;
        return workspacePage([self, grace, linus], 1, 3, 10);
      },
      [`PATCH ${base}/members/${linus.userId}`]: fail(
        409,
        'CONFLICT',
        'Workspace must retain an ADMIN',
      ),
    });
    await actions('Linus Torvalds');
    fireEvent.click(screen.getByRole('button', { name: 'Make member' }));
    const dialog = await screen.findByRole('dialog');
    const before = reads;
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Make member' }),
    );
    expect(
      await within(dialog).findByText(
        'Workspace must retain an ADMIN. The list has been refreshed.',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(reads).toBeGreaterThan(before));
  });

  it('removes a member only after the server confirms', async () => {
    let removed = false;
    const { calls } = mount(`${base}/members`, {
      [`GET ${base}/overview`]: () =>
        ok({
          ...workspaceOverviewResponse,
          workspace: admin,
          memberCount: removed ? 2 : 3,
        }),
      [membersPath]: () =>
        workspacePage(
          removed ? [self, linus] : [self, grace, linus],
          1,
          removed ? 2 : 3,
          10,
        ),
      [`DELETE ${base}/members/${grace.userId}`]: () => {
        removed = true;
        return { status: 204 };
      },
    });
    await actions('Grace Hopper');
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove from workspace' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove Grace Hopper?',
    });
    expect(dialog.textContent).toContain('stay shared with them as a guest');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remove member' }),
    );
    expect(
      await screen.findByText('Grace Hopper was removed from the workspace.'),
    ).toBeTruthy();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText('Grace Hopper')).toBeNull());
    await waitFor(() =>
      expect(screen.getAllByText('2 members').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText('3 members')).toBeNull();
  });

  it('refreshes a missing member without revoking readable Workspace data', async () => {
    let missing = false;
    const { calls, client } = mount(`${base}/members`, {
      [membersPath]: () =>
        workspacePage(
          missing ? [self, linus] : [self, grace, linus],
          1,
          missing ? 2 : 3,
          10,
        ),
      [`PATCH ${base}/members/${grace.userId}`]: () => {
        missing = true;
        return fail(404, 'NOT_FOUND', 'Member not found');
      },
    });
    await actions('Grace Hopper');
    fireEvent.click(screen.getByRole('button', { name: 'Make admin' }));
    const dialog = await screen.findByRole('dialog');
    const before = calls.filter((call) =>
      call.path.endsWith('/overview'),
    ).length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make admin' }));
    await within(dialog).findByText(
      /This member is no longer in the workspace/,
    );
    await waitFor(() => expect(screen.getByText('2 members')).toBeTruthy());
    expect(within(await table()).queryByText('Grace Hopper')).toBeNull();
    expect(screen.queryByText('Workspace not found')).toBeNull();
    await waitFor(() =>
      expect(
        calls.filter((call) => call.path.endsWith('/overview')).length,
      ).toBeGreaterThan(before),
    );
    const directory = client
      .getQueriesData<WorkspaceResponse[]>({ queryKey: workspaceKeys.all })
      .filter(([key]) => key.at(-1) === 'list');
    expect(
      directory.some(([, data]) =>
        data?.some((workspace) => workspace.id === id),
      ),
    ).toBe(true);
  });

  it.each(['role', 'remove'])(
    'still hides the Workspace after actual access loss during %s',
    async (action) => {
      let lost = false;
      mount(`${base}/members`, {
        [`GET ${base}/overview`]: () =>
          lost
            ? fail(404, 'NOT_FOUND')
            : ok({ ...workspaceOverviewResponse, workspace: admin }),
        [membersPath]: () =>
          lost
            ? fail(404, 'NOT_FOUND')
            : workspacePage([self, grace], 1, 2, 10),
        [`${action === 'role' ? 'PATCH' : 'DELETE'} ${base}/members/${grace.userId}`]:
          () => {
            lost = true;
            return fail(404, 'NOT_FOUND');
          },
      });
      await actions('Grace Hopper');
      fireEvent.click(
        screen.getByRole('button', {
          name: action === 'role' ? 'Make admin' : 'Remove from workspace',
        }),
      );
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(
        within(dialog).getByRole('button', {
          name: action === 'role' ? 'Make admin' : 'Remove member',
        }),
      );
      expect(await screen.findByText('Workspace not found')).toBeTruthy();
      expect(screen.queryByRole('table')).toBeNull();
    },
  );

  it.each(['remove', 'role'])(
    'recovers the last member page after %s and preserves filters',
    async (action) => {
      let changed = false;
      const roleFilter = action === 'role' ? '&role=MEMBER' : '';
      const { router, calls } = mount(
        `${base}/members?page=2&q=person${roleFilter}`,
        {
          [`GET ${base}/members?page=2&limit=10&search=person${roleFilter}`]:
            () =>
              workspacePage(changed ? [] : [grace], 2, changed ? 10 : 11, 10),
          [`GET ${base}/members?page=1&limit=10&search=person${roleFilter}`]:
            workspacePage([linus], 1, 10, 10),
          [`${action === 'role' ? 'PATCH' : 'DELETE'} ${base}/members/${grace.userId}`]:
            () => {
              changed = true;
              return action === 'role'
                ? ok({ ...grace, role: 'ADMIN' })
                : { status: 204 };
            },
        },
      );
      await actions('Grace Hopper');
      fireEvent.click(
        screen.getByRole('button', {
          name: action === 'role' ? 'Make admin' : 'Remove from workspace',
        }),
      );
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(
        within(dialog).getByRole('button', {
          name: action === 'role' ? 'Make admin' : 'Remove member',
        }),
      );
      await waitFor(() =>
        expect(
          within(screen.getByRole('table', { name: /Members of/ })).getByText(
            'Linus Torvalds',
          ),
        ).toBeTruthy(),
      );
      const params = new URLSearchParams(router.state.location.search);
      expect(params.get('page')).toBeNull();
      expect(params.get('q')).toBe('person');
      expect(params.get('role')).toBe(action === 'role' ? 'MEMBER' : null);
      expect(screen.queryByText('No members yet')).toBeNull();
      expect(
        calls.some((call) =>
          call.path.includes('page=1&limit=10&search=person'),
        ),
      ).toBe(true);
    },
  );

  it('does not clamp a new page using the previous placeholder response', async () => {
    let resolve!: (response: MockResponse) => void;
    const pending = new Promise<MockResponse>((done) => {
      resolve = done;
    });
    const { router } = mount(`${base}/members`, {
      [membersPath]: workspacePage([self], 1, 10, 10),
      [`GET ${base}/members?page=3&limit=10`]: () => pending,
    });
    await table();
    await act(() => router.navigate(`${base}/members?page=3`));
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe(
      '3',
    );
    await act(async () => resolve(workspacePage([grace], 3, 30, 10)));
    expect(await screen.findByText('Grace Hopper')).toBeTruthy();
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe(
      '3',
    );
  });

  it('recovers an empty filtered page even when the total becomes zero', async () => {
    const { router } = mount(`${base}/members?page=2&role=MEMBER`, {
      [`GET ${base}/members?page=2&limit=10&role=MEMBER`]: workspacePage(
        [],
        2,
        0,
        10,
      ),
      [`GET ${base}/members?page=1&limit=10&role=MEMBER`]: workspacePage(
        [],
        1,
        0,
        10,
      ),
    });
    await screen.findByText('No matching members');
    await waitFor(() =>
      expect(
        new URLSearchParams(router.state.location.search).get('page'),
      ).toBeNull(),
    );
    expect(screen.getByText('0 members matching these filters')).toBeTruthy();
  });

  it('gives a MEMBER a read-only roster and never requests invitations', async () => {
    const { calls } = mount(`${base}/members`, {}, workspaceResponse);
    await table();
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
    const invite = screen.getByRole('button', {
      name: 'Invite Member',
    }) as HTMLButtonElement;
    expect(invite.disabled).toBe(true);
    expect(
      screen.getByText('Only workspace admins can invite people.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Invitations' }));
    expect(
      await screen.findByText('Invitations are managed by admins'),
    ).toBeTruthy();
    expect(calls.some((call) => call.path.includes('/invitations'))).toBe(
      false,
    );
  });

  it('explains why a Personal workspace has no invitations', async () => {
    mount(`${base}/members`, {}, { ...admin, type: 'PERSONAL' });
    await table();
    expect(
      screen.getByText(/Personal workspaces are just for you/),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('offers Guests without requesting its protected data until selected', async () => {
    const { calls } = mount();
    await table();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Members',
      'Invitations',
      'Guests',
    ]);
    expect(
      screen.getByRole('tab', { name: 'Guests' }).getAttribute('aria-selected'),
    ).toBe('false');
    expect(calls.some((call) => /guest/i.test(call.path))).toBe(false);
  });

  it('hides the roster when the Workspace is no longer readable', async () => {
    mount(`${base}/members`, {
      [membersPath]: fail(404, 'NOT_FOUND'),
    });
    expect(await screen.findByText('Workspace not found')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('Workspace invitations', () => {
  it.each([
    ['members', 'button'],
    ['invitations', 'button'],
    ['members', 'link'],
    ['invitations', 'link'],
  ] as const)(
    'preserves %s query filters when opening the dialog via the %s',
    async (tab, trigger) => {
      const search =
        tab === 'members'
          ? 'q=grace&role=MEMBER&page=2'
          : 'tab=invitations&status=PENDING&page=2';
      const { router } = mount(`${base}/members?${search}`, {
        [`GET ${base}/members?page=2&limit=10&search=grace&role=MEMBER`]:
          workspacePage([grace], 2, 11, 10),
        [`GET ${base}/invitations?page=2&limit=10&status=PENDING`]:
          workspacePage([invitation()], 2, 11, 10),
      });
      await screen.findByRole('table');
      fireEvent.click(
        trigger === 'button'
          ? screen.getByRole('button', { name: 'Invite Member' })
          : screen.getByRole('link', { name: 'Invite' }),
      );
      const dialog = await screen.findByRole('dialog', {
        name: 'Invite member',
      });
      const expected = new URLSearchParams(search);
      expected.set('invite', '1');
      expect(new URLSearchParams(router.state.location.search)).toEqual(
        expected,
      );
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(new URLSearchParams(router.state.location.search)).toEqual(
        new URLSearchParams(search),
      );
      // Switching tabs still resets list-specific filters and pagination.
      fireEvent.click(
        screen.getByRole('tab', {
          name: tab === 'members' ? 'Invitations' : 'Members',
        }),
      );
      await waitFor(() =>
        expect(router.state.location.search).toBe(
          tab === 'members' ? '?tab=invitations' : '',
        ),
      );
    },
  );

  it.each(['9000000000000', '1000001', '0', '-1', '1.5', 'NaN', 'Infinity'])(
    'loads invitation page 1 for invalid page %s',
    async (page) => {
      const { calls } = mount(`${base}/members?tab=invitations&page=${page}`);
      await screen.findByRole('table', { name: 'Workspace invitations' });
      const requests = calls.filter((call) =>
        call.path.includes('/invitations?'),
      );
      expect(requests.map((call) => call.path)).toEqual([
        `${base}/invitations?page=1&limit=10`,
      ]);
    },
  );

  it('accepts the invitation page upper bound', async () => {
    const { calls } = mount(`${base}/members?tab=invitations&page=1000000`, {
      [`GET ${base}/invitations?page=1000000&limit=10`]: workspacePage(
        [],
        1000000,
        0,
        10,
      ),
    });
    await screen.findByText('No invitations yet');
    expect(
      calls.some(
        (call) => call.path === `${base}/invitations?page=1000000&limit=10`,
      ),
    ).toBe(true);
  });

  async function invite(response: MockResponse | (() => MockResponse)) {
    const result = mount(`${base}/members`, {
      [`POST ${base}/invitations`]: response,
    });
    await table();
    fireEvent.click(screen.getByRole('button', { name: 'Invite Member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite member' });
    fireEvent.change(within(dialog).getByLabelText('Email address'), {
      target: { value: '  New@Example.com ' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Send invitation' }),
    );
    return { ...result, dialog };
  }

  it('sends a MEMBER invitation and reports a confirmed email', async () => {
    const { calls } = await invite(ok(invitation(), 202));
    expect(
      await screen.findByText('Invitation email sent to new@example.com.'),
    ).toBeTruthy();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      email: 'new@example.com',
      role: 'MEMBER',
    });
    expect(
      screen
        .getByRole('tab', { name: 'Invitations' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never claims an email was sent when delivery is unavailable', async () => {
    await invite(ok(invitation({ sendState: 'UNAVAILABLE' }), 202));
    expect(
      await screen.findByText(
        /was saved, but email delivery is not available yet, so no email was sent/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Invitation email sent/)).toBeNull();
  });

  it('keeps the dialog open with the cooldown message on 429', async () => {
    const { dialog } = await invite(
      fail(
        429,
        'TOO_MANY_REQUESTS',
        'Wait before requesting another invitation',
      ),
    );
    expect(
      await within(dialog).findByText(/Wait a minute before sending another/),
    ).toBeTruthy();
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('validates the email before sending', async () => {
    const { calls } = mount();
    await table();
    fireEvent.click(screen.getByRole('button', { name: 'Invite Member' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Send invitation' }),
    );
    expect(
      await within(dialog).findByText('Enter an email address.'),
    ).toBeTruthy();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('shows status before delivery state and revokes after confirmation', async () => {
    let revoked = false;
    const { calls } = mount(`${base}/members?tab=invitations`, {
      [invitationsPath]: () =>
        workspacePage(
          [
            invitation({
              sendState: 'FAILED',
              ...(revoked ? { status: 'REVOKED' } : {}),
            }),
            invitation({
              id: 'invite-2',
              email: 'old@example.com',
              status: 'EXPIRED',
              sendState: 'SENT',
              invitedById: 'someone-else',
            }),
          ],
          1,
          2,
          10,
        ),
      [`DELETE ${base}/invitations/invite-1`]: () => {
        revoked = true;
        return { status: 204 };
      },
    });
    const rows = within(
      await screen.findByRole('table', { name: 'Workspace invitations' }),
    ).getAllByRole('row');
    expect(rows[1].textContent).toContain('Email failed to send');
    // An expired invitation shows no delivery claim, and no inviter identity.
    expect(rows[2].textContent).not.toContain('Email');
    expect(rows[2].textContent).toContain('Another admin');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Actions for invitation to new@example.com',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Revoke invitation' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Revoke invitation' }),
    );
    expect(
      await screen.findByText('Invitation to new@example.com was revoked.'),
    ).toBeTruthy();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('sends again through the same create request', async () => {
    const { calls } = mount(`${base}/members?tab=invitations`, {
      [invitationsPath]: workspacePage(
        [invitation({ status: 'EXPIRED' })],
        1,
        1,
        10,
      ),
      [`POST ${base}/invitations`]: ok(invitation(), 202),
    });
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Actions for invitation to new@example.com',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Invite again' }));
    expect(
      await screen.findByText('Invitation email sent to new@example.com.'),
    ).toBeTruthy();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      email: 'new@example.com',
      role: 'MEMBER',
    });
  });
});
