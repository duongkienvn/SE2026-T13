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
import { describe, expect, it, vi } from 'vitest';
import { routes } from '../../../app/routes';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../../test/mock-api';
import { createdSockets } from '../../../test/fake-socket';
import {
  workspaceBoardResponse,
  workspaceOverviewResponse,
  workspacePage,
  workspaceResponse,
} from '../../../test/workspace-fixtures';
import { AuthProvider } from '../../auth/AuthProvider';
import { RealtimeProvider } from '../../realtime/RealtimeProvider';
import type { WorkspaceResponse } from '../response';
import { workspaceKeys } from '../query-keys';
import type { WorkspacePolicy } from './api';
import { boardKeys } from '../../boards/query-keys';

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
  return { calls, router, client };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const formCases = [
  {
    section: 'general',
    endpoint: base,
    initial: admin,
    field: () => screen.findByLabelText('Workspace name'),
    edit: (element: HTMLElement) =>
      fireEvent.change(element, { target: { value: 'Private draft' } }),
    check: (edited: boolean) =>
      expect(
        (screen.getByLabelText('Workspace name') as HTMLInputElement).value,
      ).toBe(edited ? 'Private draft' : admin.name),
    changes: { name: 'Private draft' },
  },
  {
    section: 'permissions',
    endpoint: `${base}/policies`,
    initial: policy,
    field: () => screen.findByRole('radio', { name: /Admins only/ }),
    edit: (element: HTMLElement) => fireEvent.click(element),
    check: (edited: boolean) =>
      expect(
        (screen.getByRole('radio', { name: /Admins only/ }) as HTMLInputElement)
          .checked,
      ).toBe(edited),
    changes: { boardCreationAdminOnly: true },
  },
];

const sections = () =>
  screen.getByRole('navigation', { name: 'Workspace settings sections' });

function viewport(initial: number) {
  let width = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return (
        query.includes('min-width') &&
        width >= Number(query.match(/(\d+)px/)?.[1] ?? Infinity)
      );
    },
    media: query,
    addEventListener: (_event: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) =>
      listeners.delete(listener),
  }));
  return (next: number) =>
    act(() => {
      width = next;
      for (const listener of [...listeners]) listener();
    });
}

describe.each(formCases)(
  'Workspace Settings responsive draft — $section',
  (form) => {
    it.each([767, 768])(
      'keeps the same dirty form through repeated breakpoint/rotation changes starting at %spx',
      async (start) => {
        const resize = viewport(start);
        const { calls } = mount(`${base}/settings/${form.section}`);
        const input = await form.field();
        form.edit(input);
        for (const width of [768, 767, 1024, 375, 767, 768]) {
          resize(width);
          form.check(true);
          expect(await form.field()).toBe(input);
        }
        expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
        expect(
          (
            screen.getByRole('button', {
              name: 'Save Changes',
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        form.check(false);
      },
    );
    it('preserves a failed save and dirty state across resize', async () => {
      const resize = viewport(767);
      mount(`${base}/settings/${form.section}`, {
        [`PATCH ${form.endpoint}`]: fail(503, 'SERVICE_UNAVAILABLE'),
      });
      form.edit(await form.field());
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      await screen.findByRole('alert');
      resize(768);
      resize(767);
      form.check(true);
      expect(screen.getByRole('alert').textContent).toContain('kept');
    });
  },
);

describe('Workspace Settings — General', () => {
  it('keeps validation through resize, then saves the corrected draft', async () => {
    const resize = viewport(767);
    const { calls } = mount(`${base}/settings/general`, {
      [`PATCH ${base}`]: (request) =>
        ok({ ...admin, ...(request.body as object) }),
    });
    const input = await screen.findByLabelText('Workspace name');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await screen.findByText('Enter a workspace name.');
    resize(768);
    resize(767);
    expect(screen.getByText('Enter a workspace name.')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Resized and saved' } });
    resize(768);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await screen.findByText('Workspace settings saved.');
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      name: 'Resized and saved',
    });
  });
  it('keeps the dirty navigation guard after resize and allows clean browser Back', async () => {
    const resize = viewport(768);
    const { router } = mount(`${base}/settings/general`);
    await screen.findByLabelText('Workspace name');
    await act(() => router.navigate(`${base}/settings/permissions`));
    fireEvent.click(await screen.findByRole('radio', { name: /Admins only/ }));
    resize(767);
    resize(768);
    await act(() => router.navigate(-1));
    const dialog = await screen.findByRole('dialog', {
      name: 'Discard unsaved changes?',
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Keep editing' }),
    );
    expect(
      (screen.getByRole('radio', { name: /Admins only/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(() => router.navigate(-1));
    await screen.findByLabelText('Workspace name');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('does not clear newer field edits when an earlier save completes', async () => {
    const pending = deferred<MockResponse>();
    let server = admin;
    const { client, calls } = mount(`${base}/settings/general`, {
      [`GET ${base}`]: () => ok(server),
      [`PATCH ${base}`]: () => pending.promise,
    });
    const name = await screen.findByLabelText('Workspace name');
    fireEvent.change(name, { target: { value: 'First edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await screen.findByRole('button', { name: 'Saving…' });
    fireEvent.change(name, { target: { value: 'Newer edit' } });
    server = { ...admin, name: 'First edit' };
    await act(async () => pending.resolve(ok(server)));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(
      (screen.getByLabelText('Workspace name') as HTMLInputElement).value,
    ).toBe('Newer edit');
    expect(
      (
        screen.getByRole('button', {
          name: 'Save Changes',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      name: 'First edit',
    });
  });
  it.each(['name', 'description', 'icon'] as const)(
    'merges explicit %s edits over concurrent server metadata and PATCHes only that field',
    async (field) => {
      let server = {
        ...admin,
        description: 'Original description',
        icon: 'briefcase' as WorkspaceResponse['icon'],
      };
      const { client, calls } = mount(`${base}/settings/general`, {
        [`GET ${base}`]: () => ok(server),
        [`PATCH ${base}`]: (request) => {
          server = { ...server, ...(request.body as object) };
          return ok(server);
        },
      });
      await screen.findByLabelText('Workspace name');
      if (field === 'name')
        fireEvent.change(screen.getByLabelText('Workspace name'), {
          target: { value: 'My edit' },
        });
      else if (field === 'description')
        fireEvent.change(screen.getByLabelText('Description'), {
          target: { value: 'My edit' },
        });
      else fireEvent.click(screen.getByRole('radio', { name: 'Code' }));
      server = {
        ...server,
        name: 'Concurrent name',
        description: 'Concurrent description',
        icon: 'palette',
      };
      await act(() =>
        client.refetchQueries({
          queryKey: workspaceKeys.detail(testUser.id, 0, id),
        }),
      );
      await waitFor(() => {
        expect(
          (screen.getByLabelText('Workspace name') as HTMLInputElement).value,
        ).toBe(field === 'name' ? 'My edit' : 'Concurrent name');
        expect(
          (screen.getByLabelText('Description') as HTMLTextAreaElement).value,
        ).toBe(field === 'description' ? 'My edit' : 'Concurrent description');
        expect(
          screen
            .getByRole('radio', { name: field === 'icon' ? 'Code' : 'Palette' })
            .getAttribute('aria-checked'),
        ).toBe('true');
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      await screen.findByText('Workspace settings saved.');
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        [field]: field === 'icon' ? 'code' : 'My edit',
      });
      expect(server.description).toBe(
        field === 'description' ? 'My edit' : 'Concurrent description',
      );
    },
  );
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

describe.each(formCases)(
  'Workspace Settings draft boundaries — $section',
  (form) => {
    it('does not let a save from revoked access clear a newly authorized draft', async () => {
      const pending = deferred<MockResponse>();
      const { client } = mount(`${base}/settings/${form.section}`, {
        [`PATCH ${form.endpoint}`]: () => pending.promise,
      });
      form.edit(await form.field());
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      await screen.findByRole('button', { name: 'Saving…' });
      await act(async () =>
        createdSockets
          .at(-1)!
          .socket.push('workspace:access-revoked', { workspaceId: id }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Save Changes' }),
        ).toBeNull(),
      );
      await act(() =>
        client.refetchQueries({
          queryKey: workspaceKeys.resource(testUser.id, 0, id),
        }),
      );
      form.edit(await form.field());
      await act(async () =>
        pending.resolve(ok({ ...form.initial, ...form.changes })),
      );
      await waitFor(() => expect(client.isMutating()).toBe(0));
      form.check(true);
      expect(
        screen.queryByText(/^(Workspace settings|Permissions) saved\.$/),
      ).toBeNull();
      expect(
        (
          screen.getByRole('button', {
            name: 'Save Changes',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });
    it.each(['disconnect', 'access:changed'] as const)(
      'hides protected fields during %s and restores edits over fresh server values',
      async (event) => {
        const pending = deferred<MockResponse>();
        let hold = false;
        const fresh = {
          ...form.initial,
          description: 'Remote description',
          icon: 'palette',
          boardInvitesEnabled: false,
        };
        const { calls } = mount(`${base}/settings/${form.section}`, {
          [`GET ${form.endpoint}`]: () =>
            hold ? pending.promise : ok(form.initial),
          [`PATCH ${form.endpoint}`]: ok({ ...fresh, ...form.changes }),
        });
        await form.field();
        const socket = createdSockets.at(-1)!.socket;
        await act(async () => socket.open());
        form.edit(await form.field());
        hold = true;
        await act(async () => {
          if (event === 'disconnect') socket.drop();
          else socket.push('access:changed', {});
        });
        await waitFor(() =>
          expect(
            screen.queryByRole('button', { name: 'Save Changes' }),
          ).toBeNull(),
        );
        expect(screen.queryByDisplayValue('Private draft')).toBeNull();
        expect(screen.queryByRole('radio', { name: /Admins only/ })).toBeNull();
        if (event === 'disconnect') await act(async () => socket.open());
        await act(async () => pending.resolve(ok(fresh)));
        await form.field();
        form.check(true);
        if (form.section === 'general')
          expect(
            (screen.getByLabelText('Description') as HTMLTextAreaElement).value,
          ).toBe('Remote description');
        else
          expect(
            (
              within(
                screen
                  .getByText('Board owners can add board members')
                  .closest('fieldset')!,
              ).getByRole('radio', { name: /Not allowed/ }) as HTMLInputElement
            ).checked,
          ).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        await waitFor(() =>
          expect(calls.some((call) => call.method === 'PATCH')).toBe(true),
        );
        expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual(
          form.changes,
        );
      },
    );

    it('keeps edits after a transient failed refetch and retry', async () => {
      let failing = false;
      const { client } = mount(`${base}/settings/${form.section}`, {
        [`GET ${form.endpoint}`]: () =>
          failing ? fail(500, 'INTERNAL_SERVER_ERROR') : ok(form.initial),
      });
      form.edit(await form.field());
      failing = true;
      await act(() =>
        client.refetchQueries({
          queryKey: workspaceKeys.resource(testUser.id, 0, id),
        }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Save Changes' }),
        ).toBeNull(),
      );
      failing = false;
      await act(() =>
        client.refetchQueries({
          queryKey: workspaceKeys.resource(testUser.id, 0, id),
        }),
      );
      await form.field();
      form.check(true);
    });

    it.each(['socket', '403', '404'])(
      'clears edits on confirmed %s access loss even if access is later restored',
      async (source) => {
        let denial: string | undefined;
        const { client } = mount(`${base}/settings/${form.section}`, {
          [`GET ${form.endpoint}`]: () =>
            denial ? fail(Number(denial), 'DENIED') : ok(form.initial),
        });
        form.edit(await form.field());
        if (source === 'socket')
          await act(async () =>
            createdSockets
              .at(-1)!
              .socket.push('workspace:access-revoked', { workspaceId: id }),
          );
        else {
          denial = source;
          await act(() =>
            client.refetchQueries({
              queryKey: workspaceKeys.resource(testUser.id, 0, id),
            }),
          );
        }
        await waitFor(() =>
          expect(
            screen.queryByRole('button', { name: 'Save Changes' }),
          ).toBeNull(),
        );
        expect(screen.queryByDisplayValue('Private draft')).toBeNull();
        denial = undefined;
        await act(() =>
          client.refetchQueries({
            queryKey: workspaceKeys.resource(testUser.id, 0, id),
          }),
        );
        await form.field();
        form.check(false);
        expect(
          (
            screen.getByRole('button', {
              name: 'Save Changes',
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(true);
      },
    );

    it('clears edits on loss of editing permission without displaying drafts in the read-only form', async () => {
      let canEdit = true;
      const { client } = mount(`${base}/settings/${form.section}`, {
        [`GET ${form.endpoint}`]: () =>
          ok({
            ...form.initial,
            canManage: canEdit,
            canManagePolicies: canEdit,
          }),
      });
      form.edit(await form.field());
      canEdit = false;
      await act(() =>
        client.refetchQueries({
          queryKey: workspaceKeys.resource(testUser.id, 0, id),
        }),
      );
      await waitFor(() => form.check(false));
      expect(screen.queryByRole('button', { name: 'Save Changes' })).toBeNull();
      canEdit = true;
      await act(() =>
        client.refetchQueries({
          queryKey: workspaceKeys.resource(testUser.id, 0, id),
        }),
      );
      await screen.findByRole('button', { name: 'Save Changes' });
      form.check(false);
    });

    it.each(['same-user', 'other-user', 'logout'])(
      'does not carry edits across a %s authentication boundary',
      async (change) => {
        let currentUser = testUser;
        const { client, router } = mount(`${base}/settings/${form.section}`, {
          'GET /users/me': () => ok(currentUser),
        });
        form.edit(await form.field());
        await act(async () => {
          if (change === 'logout') localStorage.removeItem('kanban.session');
          else {
            if (change === 'other-user')
              currentUser = {
                ...testUser,
                id: 'another-user',
                email: 'other@example.com',
              };
            storeSession('replacement-session');
          }
          window.dispatchEvent(
            new StorageEvent('storage', { key: 'kanban.session' }),
          );
        });
        if (change === 'logout') {
          await waitFor(() =>
            expect(router.state.location.pathname).toBe('/login'),
          );
          expect(screen.queryByDisplayValue('Private draft')).toBeNull();
          await act(async () => {
            storeSession('new-login-session');
            window.dispatchEvent(
              new StorageEvent('storage', { key: 'kanban.session' }),
            );
          });
        }
        await form.field();
        form.check(false);
        expect(
          client.getQueryData(workspaceKeys.detail(testUser.id, 0, id)),
        ).toBeUndefined();
      },
    );

    it('settles a save while hidden without retaining an already-saved draft', async () => {
      const pending = deferred<MockResponse>();
      let server: object = form.initial;
      mount(`${base}/settings/${form.section}`, {
        [`GET ${form.endpoint}`]: () => ok(server),
        [`PATCH ${form.endpoint}`]: () => pending.promise,
      });
      await form.field();
      const socket = createdSockets.at(-1)!.socket;
      await act(async () => socket.open());
      form.edit(await form.field());
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
      await screen.findByRole('button', { name: 'Saving…' });
      await act(async () => socket.drop());
      server = { ...form.initial, ...form.changes };
      await act(async () => pending.resolve(ok(server)));
      // A later authoritative update must not be masked by the completed draft.
      server = form.initial;
      await act(async () => socket.open());
      await form.field();
      form.check(false);
      expect(
        (
          screen.getByRole('button', {
            name: 'Save Changes',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    });
  },
);

describe('Workspace Settings — Permissions', () => {
  it('hides only the redundant Personal creation policy and retains three Board OWNER policies', async () => {
    mount(`${base}/settings/permissions`, {}, { ...admin, type: 'PERSONAL' });
    await screen.findByText('Board owners can add board members');
    expect(screen.queryByText('Who can create boards')).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    expect(
      screen.getByText('Board owners can change board members'),
    ).toBeTruthy();
    expect(
      screen.getByText('Board owners can change board visibility'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Board guests collaborate through direct board membership/,
      ),
    ).toBeTruthy();
  });
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
      name: /All members/,
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
    const { calls, client } = mount(`${base}/boards`, {
      [boardsPath]: workspacePage([board]),
      [`POST /boards/${board.id}/move-workspace`]: ok(board),
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
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
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: boardKeys.detail(board.id),
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: boardKeys.lists() });
    for (const workspaceId of [id, other.id])
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: workspaceKeys.resource(testUser.id, 0, workspaceId),
      });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: boardKeys.all });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: workspaceKeys.session(testUser.id, 0),
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

  it.each([
    ['visibility', true],
    ['visibility', false],
    ['move', true],
    ['move', false],
  ] as const)(
    'completes Workspace %s after access:changed before REST (reload first: %s)',
    async (action, reloadFirst) => {
      const pending = deferred<MockResponse>();
      const recheck = deferred<void>();
      let resync = false;
      const saved = {
        ...board,
        workspaceId: action === 'move' ? other.id : id,
        visibility:
          action === 'visibility'
            ? ('WORKSPACE_VISIBLE' as const)
            : ('PRIVATE' as const),
        capabilities: {
          canReadBoard: true,
          canWriteBoard: true,
          canManageBoard: true,
          canManageMembers: true,
          canRestoreBoard: false,
        },
      };
      const method = action === 'visibility' ? 'PATCH' : 'POST';
      const { client, calls } = mount(`${base}/boards`, {
        [boardsPath]: () =>
          resync
            ? recheck.promise.then(() =>
                workspacePage(action === 'move' ? [] : [saved]),
              )
            : workspacePage([board]),
        [capabilities]: ok({
          canInviteMembers: true,
          canChangeMembership: true,
          canChangeVisibility: true,
        }),
        [`GET /boards/${board.id}`]: () =>
          recheck.promise.then(() => ok(saved)),
        [`${method} /boards/${board.id}/${action === 'visibility' ? 'visibility' : 'move-workspace'}`]:
          () => pending.promise,
      });
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      await openMenu();
      fireEvent.click(
        screen.getByRole('button', {
          name:
            action === 'visibility' ? 'Change visibility' : 'Move to workspace',
        }),
      );
      const dialog = await screen.findByRole('dialog');
      if (action === 'visibility') {
        const radio = within(dialog).getByRole('radio', { name: /Workspace/ });
        await waitFor(() => expect(radio.matches(':disabled')).toBe(false));
        fireEvent.click(radio);
      } else {
        await within(dialog).findByRole('option', { name: other.name });
        fireEvent.change(within(dialog).getByRole('combobox'), {
          target: { value: other.id },
        });
      }
      fireEvent.submit(dialog.querySelector('form')!);
      await within(dialog).findByRole('button', {
        name: action === 'visibility' ? 'Saving…' : 'Moving…',
      });
      act(() => {
        resync = true;
        createdSockets.at(-1)!.socket.push('access:changed', {});
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      if (reloadFirst) {
        await act(async () => recheck.resolve(undefined));
        if (action === 'visibility') {
          const restored = await screen.findByRole('dialog');
          expect(
            within(restored).getByRole('button', { name: 'Saving…' }),
          ).toBeTruthy();
          fireEvent.submit(restored.querySelector('form')!);
        } else
          await screen.findByRole('heading', {
            name: 'No accessible boards yet',
          });
      }
      await act(async () => pending.resolve(ok(saved)));
      if (!reloadFirst) await act(async () => recheck.resolve(undefined));
      await waitFor(() => expect(client.isMutating()).toBe(0));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: boardKeys.detail(board.id),
      });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: workspaceKeys.resource(testUser.id, 0, id),
      });
      if (action === 'move')
        expect(invalidate).toHaveBeenCalledWith({
          queryKey: workspaceKeys.resource(testUser.id, 0, other.id),
        });
      expect(calls.filter((c) => c.method === method)).toHaveLength(1);
    },
  );

  it.each(['revoked', 'recheck-denied', 'session'] as const)(
    'suppresses Workspace completion after access:changed and %s',
    async (transition) => {
      const pending = deferred<MockResponse>();
      const { client } = mount(`${base}/boards`, {
        [boardsPath]: workspacePage([board]),
        [`GET /boards/${board.id}`]: fail(404, 'NOT_FOUND'),
        [`POST /boards/${board.id}/move-workspace`]: () => pending.promise,
      });
      await openMenu();
      fireEvent.click(
        screen.getByRole('button', { name: 'Move to workspace' }),
      );
      const dialog = await screen.findByRole('dialog');
      await within(dialog).findByRole('option', { name: other.name });
      fireEvent.change(within(dialog).getByRole('combobox'), {
        target: { value: other.id },
      });
      fireEvent.submit(dialog.querySelector('form')!);
      await within(dialog).findByRole('button', { name: 'Moving…' });
      act(() => createdSockets.at(-1)!.socket.push('access:changed', {}));
      await screen.findByRole('button', { name: `Actions for ${board.name}` });
      act(() => {
        if (transition === 'revoked')
          createdSockets
            .at(-1)!
            .socket.push('board:access-revoked', { boardId: board.id });
        if (transition === 'session') {
          localStorage.removeItem('kanban.session');
          window.dispatchEvent(
            new StorageEvent('storage', { key: 'kanban.session' }),
          );
        }
      });
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      await act(async () => pending.resolve(ok(board)));
      await waitFor(() => expect(client.isMutating()).toBe(0));
      expect(invalidate).not.toHaveBeenCalledWith({
        queryKey: workspaceKeys.resource(testUser.id, 0, other.id),
      });
      expect(client.getQueryData(boardKeys.detail(board.id))).toBeUndefined();
    },
  );
});
