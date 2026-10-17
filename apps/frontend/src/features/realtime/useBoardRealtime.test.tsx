import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../app/AppProviders';
import { makeCard, okPage } from '../../test/board-fixtures';
import { asRealtimeSocket, FakeSocket, joined } from '../../test/fake-socket';
import { fail, mockApi, ok, storeSession, testUser } from '../../test/mock-api';
import { useAuth } from '../auth/useAuth';
import { useCards } from '../cards/hooks';
import { RealtimeProvider } from './RealtimeProvider';
import { useBoardRealtime } from './useBoardRealtime';

const sockets = vi.hoisted(() => ({
  created: [] as { socket: unknown; getAccessToken: () => Promise<string> }[],
}));
vi.mock('./socket-client', () => ({
  createRealtimeSocket: (getAccessToken: () => Promise<string>) => {
    const socket = new FakeSocket();
    sockets.created.push({ socket, getAccessToken });
    return asRealtimeSocket(socket);
  },
}));

const BOARD = '11111111-1111-4111-8111-111111111111';
const CARDS = `GET /boards/${BOARD}/cards?page=1&limit=100`;

function lastSocket() {
  const created = sockets.created.at(-1);
  if (!created) throw new Error('No socket was created.');
  return { ...created, socket: created.socket as FakeSocket };
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppProviders>
    <RealtimeProvider>{children}</RealtimeProvider>
  </AppProviders>
);

const strictWrapper = ({ children }: { children: ReactNode }) => (
  <StrictMode>{wrapper({ children })}</StrictMode>
);

beforeEach(() => {
  sockets.created.length = 0;
});

describe('useBoardRealtime', () => {
  it('opens no socket while signed out', async () => {
    mockApi({});

    const { result } = renderHook(() => useBoardRealtime(BOARD), { wrapper });
    await act(() => Promise.resolve());

    expect(result.current).toBe('connecting');
    expect(sockets.created).toEqual([]);
  });

  it('connects with the session token once signed in, and goes live after the ACK', async () => {
    storeSession('socket-token');
    mockApi({ 'GET /users/me': ok(testUser) });

    const { result } = renderHook(() => useBoardRealtime(BOARD), { wrapper });
    await waitFor(() => expect(sockets.created).toHaveLength(1));
    const { socket, getAccessToken } = lastSocket();
    expect(socket.connect).toHaveBeenCalled();
    await expect(getAccessToken()).resolves.toBe('socket-token');

    act(() => socket.open());
    act(() => socket.lastJoin().reply(joined(BOARD)));

    expect(socket.lastJoin().boardId).toBe(BOARD);
    expect(result.current).toBe('live');
  });

  it('refetches the cards from REST when another user changes one', async () => {
    storeSession();
    let listCalls = 0;
    const first = makeCard({ boardId: BOARD, title: 'Before' });
    mockApi({
      'GET /users/me': ok(testUser),
      [CARDS]: () => {
        listCalls += 1;
        return okPage([{ ...first, title: `Version ${listCalls}` }]);
      },
    });

    const { result } = renderHook(
      () => ({ cards: useCards(BOARD), status: useBoardRealtime(BOARD) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.cards.isSuccess).toBe(true));
    await waitFor(() => expect(sockets.created).toHaveLength(1));
    const { socket } = lastSocket();
    act(() => socket.open());
    act(() => socket.lastJoin().reply(joined(BOARD)));
    // The join resync catches up on anything missed before joining.
    await waitFor(() => expect(listCalls).toBe(2));

    act(() =>
      socket.push('card:updated', {
        boardId: BOARD,
        cardId: first.id,
        columnId: first.columnId,
      }),
    );

    await waitFor(() =>
      expect(result.current.cards.data?.[0].title).toBe('Version 3'),
    );
  });

  it('joins once under StrictMode', async () => {
    storeSession();
    mockApi({ 'GET /users/me': ok(testUser) });

    renderHook(() => useBoardRealtime(BOARD), { wrapper: strictWrapper });
    await waitFor(() => expect(sockets.created.length).toBeGreaterThan(0));
    const { socket } = lastSocket();
    act(() => socket.open());

    const opened = sockets.created.map((c) => c.socket as FakeSocket);
    const connected = opened.filter((s) => s.connect.mock.calls.length > 0);
    expect(connected).toEqual([socket]);
    expect(socket.requests('board:join')).toHaveLength(1);
    expect(socket.listenerCount('card:moved')).toBe(1);
  });

  it('closes the socket and refuses its token after sign-out', async () => {
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      'POST /auth/logout': ok(null),
    });

    const { result } = renderHook(
      () => ({ auth: useAuth(), status: useBoardRealtime(BOARD) }),
      { wrapper },
    );
    await waitFor(() => expect(sockets.created).toHaveLength(1));
    const { socket, getAccessToken } = lastSocket();
    act(() => socket.open());

    act(() => result.current.auth.signOut());

    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.listenerCount('connect')).toBe(0);
    await expect(getAccessToken()).rejects.toThrow();
    expect(sockets.created).toHaveLength(1);
  });

  it('re-checks the session when the server closes the socket', async () => {
    storeSession();
    let meCalls = 0;
    mockApi({
      'GET /users/me': () => {
        meCalls += 1;
        return meCalls === 1 ? ok(testUser) : fail(401, 'UNAUTHORIZED');
      },
    });

    const { result } = renderHook(
      () => ({ auth: useAuth(), status: useBoardRealtime(BOARD) }),
      { wrapper },
    );
    await waitFor(() => expect(sockets.created).toHaveLength(1));
    const { socket } = lastSocket();
    act(() => socket.open());

    act(() => socket.serverDisconnect());

    await waitFor(() => expect(result.current.auth.status).toBe('anonymous'));
    expect(socket.listenerCount('connect')).toBe(0);
  });
});
