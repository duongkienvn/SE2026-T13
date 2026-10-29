import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
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
} from '../../../test/mock-api';
import {
  workspaceBoardResponse,
  workspaceOverviewResponse,
  workspacePage,
  workspaceResponse,
} from '../../../test/workspace-fixtures';
import { AuthProvider } from '../../auth/AuthProvider';
import { RealtimeProvider } from '../../realtime/RealtimeProvider';
import type { WorkspaceResponse } from '../response';
import type { WorkspacePolicy } from './api';

const admin: WorkspaceResponse = {
  ...workspaceResponse,
  role: 'ADMIN',
  canManage: true,
};
const id = admin.id;
const base = `/workspaces/${id}`;
const policy: WorkspacePolicy = {
  boardCreationAdminOnly: false,
  boardInvitesEnabled: true,
  boardMembershipChangesEnabled: true,
  boardVisibilityChangesEnabled: true,
  canManagePolicies: true,
  canCreateBoards: true,
};
const other: WorkspaceResponse = {
  ...admin,
  id: '00000000-0000-4000-8000-000000000999',
  name: 'Design',
};
const locked: WorkspaceResponse = {
  ...admin,
  id: '00000000-0000-4000-8000-000000000998',
  name: 'Locked',
  canCreateBoards: false,
};

function mount(
  path: string,
  overrides: Parameters<typeof mockApi>[0] = {},
  workspace: WorkspaceResponse = admin,
) {
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    'GET /workspaces?page=1&limit=100': workspacePage(
      [workspace, other, locked],
      1,
      3,
      100,
    ),
    [`GET ${base}/overview`]: ok({
      ...workspaceOverviewResponse,
      workspace,
      memberCount: 4,
    }),
    [`GET ${base}`]: ok(workspace),
    [`GET ${base}/policies`]: ok({
      ...policy,
      canManagePolicies: workspace.role === 'ADMIN',
    }),
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
  return { calls, router };
}

const sections = () =>
  screen.getByRole('navigation', { name: 'Workspace settings sections' });

describe('Workspace Settings — General', () => {
  it('opens General and saves only changed fields after confirmation', async () => {
    const { calls, router } = mount(`${base}/settings`, {
      [`PATCH ${base}`]: (request) =>
        ok({ ...admin, ...(request.body as object) }),
    });
    const name = (await screen.findByLabelText(
      'Workspace name',
    )) as HTMLInputElement;
    expect(router.state.location.pathname).toBe(`${base}/settings/general`);
    expect(
      within(sections())
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'General',
      'Members & Invitations',
      'Permissions',
      'Danger Zone',
    ]);
    const save = screen.getByRole('button', {
      name: 'Save Changes',
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(name, { target: { value: '  Platform  ' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Code' }));
    fireEvent.click(save);
    expect(await screen.findByText('Workspace settings saved.')).toBeTruthy();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      name: 'Platform',
      icon: 'code',
    });
  });

  it('keeps the draft and explains a failed save', async () => {
    mount(`${base}/settings/general`, {
      [`PATCH ${base}`]: fail(409, 'CONFLICT'),
    });
    const name = (await screen.findByLabelText(
      'Workspace name',
    )) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Draft name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(
      await screen.findByText(/Someone else changed this workspace/),
    ).toBeTruthy();
    expect(name.value).toBe('Draft name');
  });

  it('requires a name', async () => {
    const { calls } = mount(`${base}/settings/general`);
    fireEvent.change(await screen.findByLabelText('Workspace name'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Enter a workspace name.')).toBeTruthy();
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('is read-only for a MEMBER with no Save button', async () => {
    mount(`${base}/settings/general`, {}, workspaceResponse);
    const name = (await screen.findByLabelText(
      'Workspace name',
    )) as HTMLInputElement;
    expect(name.readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save Changes' })).toBeNull();
    expect(
      (screen.getByRole('radio', { name: 'Code' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe('Workspace Settings — Permissions', () => {
  it('sends only the changed policy and explains the effect', async () => {
    const { calls } = mount(`${base}/settings/permissions`, {
      [`PATCH ${base}/policies`]: ok({
        ...policy,
        boardCreationAdminOnly: true,
      }),
    });
    fireEvent.click(await screen.findByRole('radio', { name: /Admins only/ }));
    expect(
      screen.getByText(/never let a workspace admin open a private board/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('Permissions saved.')).toBeTruthy();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      boardCreationAdminOnly: true,
    });
  });

  it('shows a MEMBER the current rules without controls', async () => {
    mount(`${base}/settings/permissions`, {}, workspaceResponse);
    const radio = (await screen.findByRole('radio', {
      name: /All workspace members/,
    })) as HTMLInputElement;
    expect(radio.checked).toBe(true);
    expect(radio.matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save Changes' })).toBeNull();
  });
});

describe('Workspace Settings — Members and Danger Zone', () => {
  it('links to the real Members page instead of a second roster', async () => {
    mount(`${base}/settings/members`);
    expect(await screen.findByText('4')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Manage invitations' })
        .getAttribute('href'),
    ).toBe(`${base}/members?tab=invitations`);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('leaves a Team only after confirmation and returns to Workspaces', async () => {
    const { calls, router } = mount(`${base}/settings/danger`, {
      [`POST ${base}/leave`]: { status: 204 },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Leave workspace' }),
    );
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Leave workspace' }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/workspaces'),
    );
    expect(calls.filter((call) => call.path === `${base}/leave`)).toHaveLength(
      1,
    );
  });

  it('explains the last-ADMIN refusal and stays', async () => {
    const { router } = mount(`${base}/settings/danger`, {
      [`POST ${base}/leave`]: fail(
        409,
        'CONFLICT',
        'Workspace must retain an ADMIN',
      ),
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Leave workspace' }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Leave workspace' }),
    );
    expect(
      await within(dialog).findByText(/You are the last admin/),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe(`${base}/settings/danger`);
  });

  it('deletes only after the exact name and reports remaining Boards', async () => {
    const { calls } = mount(`${base}/settings/danger`, {
      [`DELETE ${base}`]: fail(409, 'CONFLICT'),
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete workspace' }),
    );
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', {
      name: 'Delete workspace',
    }) as HTMLButtonElement;
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: admin.name.toLowerCase() },
    });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: admin.name },
    });
    fireEvent.click(confirm);
    expect(await within(dialog).findByText(/still has boards/)).toBeTruthy();
    expect(calls.find((call) => call.method === 'DELETE')?.body).toEqual({
      confirmationName: admin.name,
    });
  });

  it('never offers leave or delete for a Personal workspace', async () => {
    mount(`${base}/settings/danger`, {}, { ...admin, type: 'PERSONAL' });
    const leave = (await screen.findByRole('button', {
      name: 'Leave workspace',
    })) as HTMLButtonElement;
    expect(leave.disabled).toBe(true);
    expect(
      (
        screen.getByRole('button', {
          name: 'Delete workspace',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

describe('Board OWNER visibility and move', () => {
  const boardsPath = `GET ${base}/boards?page=1&limit=20&status=active&sort=updatedAt`;
  const board = workspaceBoardResponse;
  const capabilities = `GET /boards/${board.id}/policy-capabilities`;
  const openMenu = async () =>
    fireEvent.click(
      await screen.findByRole('button', { name: `Actions for ${board.name}` }),
    );

  it('shares a private board with the workspace after the server confirms', async () => {
    const { calls } = mount(`${base}/boards`, {
      [boardsPath]: workspacePage([board]),
      [capabilities]: ok({
        canInviteMembers: true,
        canChangeMembership: true,
        canChangeVisibility: true,
      }),
      [`PATCH /boards/${board.id}/visibility`]: ok({
        ...board,
        visibility: 'WORKSPACE_VISIBLE',
      }),
    });
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Change visibility' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Board visibility',
    });
    fireEvent.click(
      await within(dialog).findByRole('radio', { name: /Workspace/ }),
    );
    await waitFor(() =>
      expect(
        (
          within(dialog).getByRole('radio', {
            name: /Workspace/,
          }) as HTMLInputElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(within(dialog).getByRole('radio', { name: /Workspace/ }));
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Share with workspace' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      visibility: 'WORKSPACE_VISIBLE',
    });
  });

  it('blocks visibility changes the workspace policy forbids', async () => {
    const { calls } = mount(`${base}/boards`, {
      [boardsPath]: workspacePage([board]),
      [capabilities]: ok({
        canInviteMembers: true,
        canChangeMembership: true,
        canChangeVisibility: false,
      }),
    });
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Change visibility' }));
    expect(
      await screen.findByText(/does not let board owners change visibility/),
    ).toBeTruthy();
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('moves only to workspaces that allow new boards', async () => {
    const { calls } = mount(`${base}/boards`, {
      [boardsPath]: workspacePage([board]),
      [`POST /boards/${board.id}/move-workspace`]: ok(board),
    });
    await openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Move to workspace' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move board' });
    const select = within(dialog).getByRole('combobox') as HTMLSelectElement;
    await waitFor(() =>
      expect([...select.options].map((option) => option.textContent)).toEqual([
        'Choose a workspace',
        'Design',
      ]),
    );
    fireEvent.change(select, { target: { value: other.id } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move board' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      destinationWorkspaceId: other.id,
    });
  });

  it('offers nothing to a Board MEMBER, even a Workspace ADMIN', async () => {
    mount(`${base}/boards`, {
      [boardsPath]: workspacePage([{ ...board, currentUserRole: 'MEMBER' }]),
    });
    await screen.findByText(board.name);
    expect(
      screen.queryByRole('button', { name: `Actions for ${board.name}` }),
    ).toBeNull();
  });
});
