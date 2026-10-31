import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthProvider';
import {
  makeBoard,
  makeCard,
  makeColumn,
  okPage,
} from '../../../test/board-fixtures';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
} from '../../../test/mock-api';
import { ArchivedCardsDialog } from './ArchivedCardsDialog';

function setup(status = 503, code = 'SERVICE_UNAVAILABLE', pending = false) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const board = makeBoard();
  const column = makeColumn({ boardId: board.id });
  const card = makeCard({
    boardId: board.id,
    columnId: column.id,
    title: 'Recovery card',
    isArchived: true,
    archivedAt: '2026-10-25T12:00:00Z',
  });
  let responseStatus = status;
  let restored = false;
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
    [`GET /boards/${board.id}/cards?status=archived&page=1&limit=20`]: () =>
      okPage(restored ? [] : [card], { limit: 20 }),
    [`POST /boards/${board.id}/cards/${card.id}/restore`]: async () => {
      if (pending) await gate;
      if (responseStatus !== 200) return fail(responseStatus, code);
      restored = true;
      return ok({ ...card, isArchived: false, archivedAt: null });
    },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const close = vi.fn();
  const view = (permissions: {
    isArchived?: boolean;
    canRestore?: boolean;
  }) => (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <ArchivedCardsDialog
          boardId={board.id}
          {...permissions}
          onClose={close}
        />
      </AuthProvider>
    </QueryClientProvider>
  );
  const ui = render(view({ isArchived: false, canRestore: true }));
  return {
    calls,
    release,
    select: async () =>
      fireEvent.click(
        await screen.findByRole('button', { name: 'Restore Recovery card' }),
      ),
    confirm: () =>
      fireEvent.click(screen.getByRole('button', { name: 'Restore card' })),
    readOnly: (value: boolean) =>
      ui.rerender(view({ isArchived: value, canRestore: !value })),
    permissions: (value: { isArchived?: boolean; canRestore?: boolean }) =>
      ui.rerender(view(value)),
    succeed: () => {
      responseStatus = 200;
    },
  };
}

describe('archived card restore recovery', () => {
  it.each([{}, { isArchived: false }])(
    'keeps unknown/loading/failed capability state disabled without asserting archive status %j',
    async (permissions) => {
      const h = setup();
      await h.select();
      h.permissions(permissions);
      expect(
        await screen.findByText(
          /Restore is unavailable while board permissions are being checked/,
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/This board is archived/)).toBeNull();
      expect(screen.queryByRole('button', { name: /^Restore / })).toBeNull();
      expect(h.calls.some((c) => c.method === 'POST')).toBe(false);
    },
  );
  it('closes a pending confirmation on lost write capability while the Board stays active', async () => {
    const h = setup();
    await h.select();
    h.permissions({ isArchived: false, canRestore: false });
    expect(
      await screen.findByText(
        'You have read-only access to this board. You cannot restore cards.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restore card' })).toBeNull();
    expect(h.calls.some((c) => c.method === 'POST')).toBe(false);
  });
  it('recovers when the board is archived and restored during a pending request', async () => {
    const h = setup(409, 'CARD_NOT_ARCHIVED', true);
    await h.select();
    h.confirm();
    await waitFor(() =>
      expect(h.calls.filter((call) => call.method === 'POST')).toHaveLength(1),
    );
    h.readOnly(true);
    expect(
      await screen.findByText(
        'This board is archived. Cards can be viewed but cannot be restored.',
      ),
    ).toBeTruthy();
    h.readOnly(false);
    const select = await screen.findByRole('button', {
      name: 'Restore Recovery card',
    });
    expect(select).toHaveProperty('disabled', true);
    fireEvent.click(select);
    await act(async () => h.release());
    await waitFor(() => expect(select).toHaveProperty('disabled', false));
    h.succeed();
    await h.select();
    h.confirm();
    expect(
      await screen.findByText('Card “Recovery card” restored.'),
    ).toBeTruthy();
    expect(h.calls.filter((call) => call.method === 'POST')).toHaveLength(2);
  });

  it('allows retry after a restore failure without announcing false success', async () => {
    const h = setup();
    await h.select();
    h.confirm();
    expect(
      await screen.findByText(
        'Something went wrong on our side. Please try again.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Card “Recovery card” restored.')).toBeNull();
    h.succeed();
    h.confirm();
    expect(
      await screen.findByText('Card “Recovery card” restored.'),
    ).toBeTruthy();
    expect(h.calls.filter((call) => call.method === 'POST')).toHaveLength(2);
  });

  it.each([403, 404])(
    'hides cached archive data when restore returns %s',
    async (status) => {
      const h = setup(status, 'BOARD_NOT_FOUND');
      await h.select();
      h.confirm();
      expect(
        await screen.findByRole('heading', {
          name: 'Archived cards unavailable',
        }),
      ).toBeTruthy();
      expect(screen.queryByText('Recovery card')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Restore card' })).toBeNull();
    },
  );

  it('clears the session and hides cached archive data on 401', async () => {
    const h = setup(401, 'UNAUTHORIZED');
    await h.select();
    h.confirm();
    expect(
      await screen.findByRole('heading', {
        name: 'Archived cards unavailable',
      }),
    ).toBeTruthy();
    expect(localStorage.getItem('kanban.session')).toBeNull();
    expect(screen.queryByText('Recovery card')).toBeNull();
  });
});
