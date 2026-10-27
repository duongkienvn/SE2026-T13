import { focusManager } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createdSockets, joined } from '../../../test/fake-socket';
import { fail, loginResponse, ok, testUser } from '../../../test/mock-api';
import { openPermalink } from '../../../test/permalink-fixtures';

afterEach(() => focusManager.setFocused(undefined));
const detail = () => screen.findByRole('dialog', { name: 'Private card' });

async function connect() {
  await waitFor(() => expect(createdSockets).toHaveLength(1));
  const { socket } = createdSockets[0];
  act(() => socket.open());
  const request = socket.lastJoin();
  act(() => request.reply(joined(request.boardId)));
  return socket;
}

describe('card permalink access and synchronization', () => {
  it('returns to the protected card URL after login without fetching private data while anonymous', async () => {
    const { router, cardPath, calls } = openPermalink({
      direct: true,
      anonymous: true,
      handlers: { 'POST /auth/login': ok(loginResponse()) },
    });
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(calls).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password-1234' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));
    await detail();
    expect(router.state.location.pathname).toBe(cardPath);
  });

  it.each([400, 403, 404])(
    'treats board refusal %s generically and never fetches a card',
    async (status) => {
      const { calls, refuseBoard } = openPermalink({ direct: true });
      refuseBoard(fail(status, 'UNAVAILABLE'));
      await screen.findByRole('heading', { name: 'Board not found' });
      expect(calls.some((call) => call.path.includes('/cards'))).toBe(false);
      expect(screen.queryByText('Private board')).toBeNull();
      expect(screen.queryByText('Private card')).toBeNull();
      expect(document.title).toBe('Board · Kanvexa');
    },
  );

  it.each([400, 403, 404])(
    'treats card refusal %s generically, hiding details and Copy link',
    async (status) => {
      const { refuseCard } = openPermalink({
        direct: true,
        archivedCard: true,
      });
      refuseCard(fail(status, 'UNAVAILABLE'));
      await screen.findByText(
        'This card no longer exists, or you no longer have access to it.',
      );
      const dialog = screen.getByRole('dialog', { name: 'Card' });
      expect(within(dialog).queryByText('Private card')).toBeNull();
      expect(within(dialog).queryByLabelText('Description')).toBeNull();
      expect(
        within(dialog).queryByRole('button', { name: 'Copy link' }),
      ).toBeNull();
    },
  );

  it.each(['board', 'card'])(
    'keeps an archived %s read-only on direct load',
    async (kind) => {
      openPermalink({
        direct: true,
        archivedBoard: kind === 'board',
        archivedCard: kind === 'card',
      });
      const dialog = await detail();
      expect(
        within(dialog).getByLabelText<HTMLInputElement>('Title').disabled,
      ).toBe(true);
      expect(
        within(dialog).queryByRole('button', { name: 'Save changes' }),
      ).toBeNull();
      expect(
        within(dialog).queryByRole('button', { name: 'Archive card' }),
      ).toBeNull();
      expect(
        within(dialog).getByRole('button', { name: 'Copy link' }),
      ).toBeTruthy();
    },
  );

  it('removes a cached detail when a card refresh is refused', async () => {
    const { board, card, refuseCard } = openPermalink({ direct: true });
    await detail();
    const socket = await connect();
    refuseCard(fail(404, 'UNAVAILABLE'));
    act(() =>
      socket.push('card:updated', { boardId: board.id, cardId: card.id }),
    );
    await screen.findByText(
      'This card no longer exists, or you no longer have access to it.',
    );
    expect(screen.queryByRole('dialog', { name: 'Private card' })).toBeNull();
    expect(screen.queryByLabelText('Description')).toBeNull();
  });

  it('hides the dialog, shell context, and page title after membership is revoked', async () => {
    const { board, refuseBoard } = openPermalink({ direct: true });
    await detail();
    const socket = await connect();
    refuseBoard(fail(503, 'UNAVAILABLE'));
    act(() =>
      socket.push('member:removed', {
        boardId: board.id,
        userId: testUser.id,
      }),
    );
    await screen.findByRole('heading', { name: 'Board not found' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Private board')).toBeNull();
    expect(screen.queryByText('Private card')).toBeNull();
    expect(document.title).toBe('Board · Kanvexa');
  });

  it('keeps a draft during realtime refresh and reconnect', async () => {
    const { board, card, refuseCard } = openPermalink({ direct: true });
    const dialog = await detail();
    const input =
      within(dialog).getByLabelText<HTMLTextAreaElement>('Description');
    fireEvent.change(input, { target: { value: 'My draft' } });
    const socket = await connect();
    refuseCard(ok({ ...card, description: 'Someone else edited this' }));
    act(() =>
      socket.push('card:updated', { boardId: board.id, cardId: card.id }),
    );
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(screen.getByLabelText('Description')).toBe(input);
    expect(input.value).toBe('My draft');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it('shows a network retry state instead of reporting a missing card', async () => {
    vi.stubGlobal('isSecureContext', false);
    const { refuseCard, card } = openPermalink({
      direct: true,
      archivedCard: true,
    });
    refuseCard(fail(503, 'UNAVAILABLE'));
    await screen.findByText(
      'We couldn’t load this card. Check your connection and try again.',
      {},
      { timeout: 6000 },
    );
    expect(screen.queryByText(/no longer exists/)).toBeNull();
    refuseCard(ok(card));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Try again',
      }),
    );
    await detail();
  }, 10000);

  it('drops private detail immediately on a session rejection, even with an unsaved draft', async () => {
    const { board, card, refuseCard } = openPermalink({ direct: true });
    const dialog = await detail();
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: 'Draft' },
    });
    const socket = await connect();
    refuseCard(fail(401, 'UNAUTHORIZED'));
    act(() =>
      socket.push('card:updated', { boardId: board.id, cardId: card.id }),
    );
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem('kanban.session')).toBeNull();
  });
  it('ignores a queued revocation from the previous session after another user signs in', async () => {
    const nextUser = {
      ...testUser,
      id: '00000000-0000-4000-8000-000000000002',
      displayName: 'Next user',
    };
    const { board, card, refuseCard } = openPermalink({
      direct: true,
      handlers: { 'POST /auth/login': ok(loginResponse(nextUser)) },
    });
    await detail();
    const socket = await connect();
    const previousListeners = socket.capture('member:removed');
    refuseCard(fail(401, 'UNAUTHORIZED'));
    act(() =>
      socket.push('card:updated', { boardId: board.id, cardId: card.id }),
    );
    await screen.findByRole('heading', { name: 'Welcome back' });
    refuseCard(ok(card));
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: nextUser.email },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password-1234' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));
    await detail();
    act(() =>
      previousListeners.forEach((listener) =>
        listener({ boardId: board.id, userId: testUser.id }),
      ),
    );
    expect(screen.getByRole('dialog', { name: 'Private card' })).toBeTruthy();
  });
});
