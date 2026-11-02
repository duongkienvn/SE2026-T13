import { focusManager } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBoard, makeMember, okPage } from '../../../test/board-fixtures';
import { createdSockets, joined } from '../../../test/fake-socket';
import {
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
import type { Board } from '../types';

function setup(
  suffix = '',
  overrides: Partial<Board> = {},
  extra: Parameters<typeof mockApi>[0] = {},
) {
  const board = makeBoard({
    name: 'Release planning',
    workspaceId: workspaceResponse.id,
    visibility: 'PRIVATE',
    ...overrides,
  });
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    'GET /workspaces?page=1&limit=100': workspacePage(
      [workspaceResponse],
      1,
      1,
      100,
    ),
    [`GET /boards/${board.id}`]: ok(board),
    [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([]),
    [`GET /boards/${board.id}/cards?page=1&limit=100`]: okPage([]),
    [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([
      makeMember(),
    ]),
    ...extra,
  });
  return { board, calls, ...renderApp(`/boards/${board.id}${suffix}`) };
}

function boardNav() {
  return within(screen.getByRole('navigation', { name: 'Board navigation' }));
}
function expectActive(label: string) {
  const nav = boardNav();
  expect(
    nav.getByRole('link', { name: label }).getAttribute('aria-current'),
  ).toBe('page');
  expect(
    screen
      .getByRole('navigation', { name: 'Board navigation' })
      .querySelectorAll('[aria-current="page"]'),
  ).toHaveLength(1);
}

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.restoreAllMocks();
});

describe('Board navigation polish', () => {
  it('keeps star and background customization accessible in the updated settings', async () => {
    const { board } = setup(
      '/settings',
      {
        backgroundPreset: 'blue',
        backgroundVersion: 0,
        currentUserRole: 'OWNER',
        capabilities: {
          canReadBoard: true,
          canWriteBoard: true,
          canManageBoard: true,
          canManageMembers: true,
          canRestoreBoard: false,
        },
      },
      {
        'GET /boards/background-presets': ok([
          { id: 'blue', kind: 'color', value: '#2563EB', foreground: 'light' },
        ]),
      },
    );
    expect(
      await screen.findByRole('button', {
        name: `Add to starred: ${board.name}`,
      }),
    ).toBeTruthy();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Change background' }),
    );
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
  it('switches Kanban → Members → Settings → Kanban with a stable header and realtime room', async () => {
    const { board, router } = setup();
    await screen.findByRole('heading', { name: board.name });
    await waitFor(() => expect(createdSockets).toHaveLength(1));
    const socket = createdSockets[0].socket;
    act(() => socket.open());
    await waitFor(() => expect(socket.requests('board:join')).toHaveLength(1));
    act(() => socket.lastJoin().reply(joined(board.id)));
    const title = screen.getByRole('heading', { name: board.name });
    expectActive('Kanban');
    for (const [tab, suffix] of [
      ['Members', '/members'],
      ['Board settings', '/settings'],
      ['Kanban', ''],
    ]) {
      fireEvent.click(boardNav().getByRole('link', { name: tab }));
      await waitFor(() =>
        expect(router.state.location.pathname).toBe(
          `/boards/${board.id}${suffix}`,
        ),
      );
      expectActive(tab);
      expect(screen.getByRole('heading', { name: board.name })).toBe(title);
      if (tab === 'Members') await screen.findByRole('table');
      if (tab === 'Board settings') {
        await screen.findByRole('heading', { name: 'General' });
        expect(
          screen.queryByRole('navigation', { name: 'Settings sections' }),
        ).toBeNull();
      }
    }
    expect(socket.requests('board:join')).toHaveLength(1);
    expect(socket.requests('board:leave')).toHaveLength(0);
    expect(createdSockets).toHaveLength(1);
  });

  it.each([
    ['', 'Kanban'],
    ['/members', 'Members'],
    ['/settings', 'Board settings'],
  ])(
    'opens %s directly with board and verified Workspace breadcrumbs',
    async (suffix, label) => {
      const { board, calls } = setup(suffix);
      await screen.findByRole('heading', { name: board.name });
      expectActive(label);
      const breadcrumb = within(
        screen.getByRole('navigation', { name: 'Board breadcrumb' }),
      );
      await breadcrumb.findByRole('link', { name: workspaceResponse.name });
      expect(
        breadcrumb.getByRole('link', { name: 'Boards' }).getAttribute('href'),
      ).toBe(`/workspaces/${workspaceResponse.id}/boards`);
      expect(screen.queryByRole('link', { name: 'Back to board' })).toBeNull();
      if (suffix) {
        if (suffix === '/members') await screen.findByRole('table');
        expect(
          calls.some((call) => /\/(cards|columns)\?/.test(call.path)),
        ).toBe(false);
      }
    },
  );

  it.each(['OWNER', 'MEMBER', null] as const)(
    'keeps the overflow menu focused for %s',
    async (role) => {
      const { board } = setup('/settings', { currentUserRole: role });
      fireEvent.click(
        await screen.findByRole('button', {
          name: `Actions for ${board.name}`,
        }),
      );
      const menu = within(
        screen.getByRole('button', { name: 'Archived cards' }).closest('ul')!,
      );
      expect(
        menu.getAllByRole('button').map((button) => button.textContent),
      ).toEqual(['Archived cards', 'Copy board link']);
      expect(
        screen.queryByRole('link', { name: 'View board members' }),
      ).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Members' })).toBeNull();
      if (role !== 'OWNER') {
        expect(screen.queryByRole('button', { name: 'Edit board' })).toBeNull();
        expect(
          screen.queryByRole('button', { name: 'Archive board' }),
        ).toBeNull();
      }
    },
  );

  it('reports clipboard success only after copying the canonical Kanban URL', async () => {
    let resolve!: () => void;
    const writeText = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { board } = setup('/members');
    fireEvent.click(
      await screen.findByRole('button', { name: `Actions for ${board.name}` }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy board link' }));
    expect(screen.queryByText('Board link copied.')).toBeNull();
    expect(writeText).toHaveBeenCalledWith(
      `${location.origin}/boards/${board.id}`,
    );
    await act(async () => resolve());
    await screen.findByText('Board link copied.');
  });

  it.each(['unavailable', 'denied'])(
    'offers a selectable board link when clipboard is %s',
    async (scenario) => {
      vi.stubGlobal('isSecureContext', true);
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value:
          scenario === 'unavailable'
            ? undefined
            : { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
      });
      const { board } = setup('/settings');
      fireEvent.click(
        await screen.findByRole('button', {
          name: `Actions for ${board.name}`,
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Copy board link' }));
      const input = (await screen.findByRole('textbox', {
        name: 'Board link',
      })) as HTMLInputElement;
      expect(input.value).toBe(`${location.origin}/boards/${board.id}`);
      expect(input.readOnly).toBe(true);
      expect(screen.queryByText('Board link copied.')).toBeNull();
    },
  );

  it('restores from Settings and stays on that route with active owner controls', async () => {
    const board = makeBoard({ isArchived: true });
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      [`POST /boards/${board.id}/restore`]: ok({ ...board, isArchived: false }),
    });
    const { router } = renderApp(`/boards/${board.id}/settings`);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Restore board' }),
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Restore board',
      }),
    );
    await screen.findByRole('button', { name: 'Edit board' });
    await screen.findByText(`Board “${board.name}” restored.`);
    expect(router.state.location.pathname).toBe(`/boards/${board.id}/settings`);
    expectActive('Board settings');
    expect(screen.queryByText(/This board is archived/)).toBeNull();
  });

  it('protects an unsaved edit when navigating toward Members', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { board, router } = setup('/settings');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit board' }));
    fireEvent.change(screen.getByLabelText('Board name'), {
      target: { value: 'Draft title' },
    });
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Save changes' })
          .matches(':disabled'),
      ).toBe(false),
    );
    await act(() => router.navigate(`/boards/${board.id}/members`));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(
      (screen.getByLabelText('Board name') as HTMLInputElement).value,
    ).toBe('Draft title');
    expectActive('Board settings');
    confirm.mockReturnValue(true);
    await act(() => router.navigate(`/boards/${board.id}/members`));
    await screen.findByRole('table');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not fetch the roster for a read-only viewer opening the Members URL', async () => {
    const { board, calls } = setup('/members', {
      currentUserRole: null,
      visibility: 'WORKSPACE_VISIBLE',
    });
    await screen.findByRole('heading', { name: board.name });
    await screen.findByRole('heading', { name: 'Board not found' });
    expect(screen.queryByRole('table')).toBeNull();
    expect(boardNav().queryByRole('link', { name: 'Members' })).toBeNull();
    expect(calls.some((call) => call.path.includes('/members'))).toBe(false);
    fireEvent.click(boardNav().getByRole('link', { name: 'Kanban' }));
    await screen.findByRole('heading', { name: 'No columns yet' });
    expectActive('Kanban');
  });

  it.each([false, true])(
    'distinguishes an own save from a conflicting refetch while REST is completing (conflict: %s)',
    async (conflict) => {
      const board = makeBoard({ name: 'Before save' });
      const saved = { ...board, name: 'Saved title' };
      let current = board;
      let resolve!: (response: MockResponse) => void;
      storeSession();
      mockApi({
        'GET /users/me': ok(testUser),
        [`GET /boards/${board.id}`]: () => ok(current),
        [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
        [`PATCH /boards/${board.id}`]: () =>
          new Promise((done) => {
            resolve = done;
          }),
      });
      renderApp(`/boards/${board.id}/settings`);
      fireEvent.click(
        await screen.findByRole('button', { name: 'Edit board' }),
      );
      fireEvent.change(screen.getByLabelText('Board name'), {
        target: { value: saved.name },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByRole('button', { name: 'Saving…' });
      // The matching socket/refetch update may arrive before the REST response.
      current = conflict ? { ...board, name: 'Another editor’s title' } : saved;
      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await screen.findByRole('heading', { name: current.name });
      const warning = screen.queryByText(
        /This board changed while you were editing/,
      );
      if (conflict) expect(warning).toBeTruthy();
      else expect(warning).toBeNull();
      await act(async () => resolve(ok(saved)));
      await screen.findByText('Board “Saved title” updated.');
    },
  );
});
