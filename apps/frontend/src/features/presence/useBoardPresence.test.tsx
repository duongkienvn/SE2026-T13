import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, useLayoutEffect, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../../app/AppProviders';
import { createdSockets, joined } from '../../test/fake-socket';
import { mockApi, ok, storeSession, testUser } from '../../test/mock-api';
import { useAuth } from '../auth/useAuth';
import { useBoardRealtime } from '../realtime/useBoardRealtime';
import { useBoardPresence } from './useBoardPresence';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const wrapper = ({ children }: { children: ReactNode }) => (
  <AppProviders>{children}</AppProviders>
);
const signIn = () => {
  storeSession();
  mockApi({ 'GET /users/me': ok(testUser), 'POST /auth/logout': ok(null) });
};

describe('useBoardPresence', () => {
  it('never renders a previous session population under a replacement account', async () => {
    storeSession();
    let activeUser = testUser;
    mockApi({ 'GET /users/me': () => ok(activeUser) });
    const observed: { userId?: string; viewers: readonly string[] | null }[] =
      [];
    const { result } = renderHook(
      () => {
        const auth = useAuth();
        useBoardRealtime(A);
        const presence = useBoardPresence(A);
        useLayoutEffect(() => {
          observed.push({ userId: auth.user?.id, viewers: presence.userIds });
        }, [auth.user, presence]);
        return { auth, presence };
      },
      { wrapper },
    );
    await waitFor(() => expect(createdSockets).toHaveLength(1));
    const { socket } = createdSockets[0];
    act(() => {
      socket.open();
      socket.push('presence:sync', { boardId: A, userIds: [testUser.id] });
      socket.lastJoin().reply(joined(A));
    });
    const [staleEvent] = socket.capture('presence:sync');
    activeUser = { ...testUser, id: B, displayName: 'Another account' };
    act(() =>
      result.current.auth.signIn({
        accessToken: 'replacement-session',
        expiresIn: 3600,
        tokenType: 'Bearer',
        user: activeUser,
      }),
    );
    await waitFor(() => expect(createdSockets).toHaveLength(2));
    expect(
      observed
        .filter((entry) => entry.userId === B)
        .every((entry) => entry.viewers === null),
    ).toBe(true);
    expect(socket.disconnect).toHaveBeenCalled();
    act(() => staleEvent({ boardId: A, userIds: [testUser.id] }));
    expect(result.current.presence.userIds).toBeNull();
  });
  it('only subscribes; it never opens a socket or creates a watcher', async () => {
    signIn();
    const { result } = renderHook(
      () => ({ auth: useAuth(), presence: useBoardPresence(A) }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.auth.status).toBe('authenticated'),
    );
    expect(createdSockets).toHaveLength(0);
    expect(result.current.presence.userIds).toBeNull();
  });
  it('shares the page watcher, buffers before ACK and keeps stable references for duplicate snapshots', async () => {
    signIn();
    const { result, unmount } = renderHook(
      () => {
        useBoardRealtime(A);
        return useBoardPresence(A);
      },
      { wrapper },
    );
    await waitFor(() => expect(createdSockets).toHaveLength(1));
    const { socket } = createdSockets[0];
    act(() => {
      socket.open();
      socket.push('presence:sync', { boardId: A, userIds: [testUser.id] });
    });
    expect(result.current.userIds).toBeNull();
    act(() => socket.lastJoin().reply(joined(A)));
    const snapshot = result.current;
    expect(snapshot.userIds).toEqual([testUser.id]);
    act(() =>
      socket.push('presence:sync', { boardId: A, userIds: [testUser.id] }),
    );
    expect(result.current).toBe(snapshot);
    expect(socket.requests('board:join')).toHaveLength(1);
    unmount();
    expect(socket.listenerCount('presence:sync')).toBe(0);
  });
  it('masks disabled rooms, switches boards and clears state immediately on logout', async () => {
    signIn();
    const { result, rerender } = renderHook(
      ({ boardId, enabled }) => {
        useBoardRealtime(boardId, { enabled });
        return {
          auth: useAuth(),
          presence: useBoardPresence(boardId, { enabled }),
        };
      },
      { wrapper, initialProps: { boardId: A, enabled: true } },
    );
    await waitFor(() => expect(createdSockets).toHaveLength(1));
    const { socket } = createdSockets[0];
    act(() => {
      socket.open();
      socket.push('presence:sync', { boardId: A, userIds: [testUser.id] });
      socket.lastJoin().reply(joined(A));
    });
    rerender({ boardId: B, enabled: true });
    expect(result.current.presence.userIds).toBeNull();
    await waitFor(() => expect(socket.lastJoin().boardId).toBe(B));
    act(() => {
      socket.push('presence:sync', { boardId: B, userIds: [testUser.id] });
      socket.lastJoin().reply(joined(B));
    });
    rerender({ boardId: B, enabled: false });
    expect(result.current.presence).toEqual({
      status: 'unavailable',
      userIds: null,
    });
    act(() => result.current.auth.signOut());
    expect(result.current.presence.userIds).toBeNull();
    expect(socket.listenerCount('presence:sync')).toBe(0);
  });
  it('keeps one connection and listener under StrictMode and waits for fresh data after reconnect', async () => {
    signIn();
    const { result } = renderHook(
      () => {
        useBoardRealtime(A);
        return useBoardPresence(A);
      },
      {
        wrapper: ({ children }) => (
          <StrictMode>{wrapper({ children })}</StrictMode>
        ),
      },
    );
    await waitFor(() => expect(createdSockets).toHaveLength(1));
    const { socket } = createdSockets[0];
    act(() => {
      socket.open();
      socket.push('presence:sync', { boardId: A, userIds: [testUser.id] });
      socket.lastJoin().reply(joined(A));
    });
    act(() => socket.drop());
    expect(result.current).toEqual({ status: 'reconnecting', userIds: null });
    act(() => {
      socket.open();
      socket.lastJoin().reply(joined(A));
    });
    expect(result.current).toEqual({ status: 'syncing', userIds: null });
    act(() => socket.push('presence:sync', { boardId: A, userIds: [] }));
    expect(result.current).toEqual({ status: 'live', userIds: [] });
    expect(socket.listenerCount('presence:sync')).toBe(1);
  });
});
