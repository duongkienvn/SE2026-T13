import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { makeBoard, makeCard } from '../../test/board-fixtures';
import { useUpdateBoard } from './hooks';
import { useUpdateCard } from '../cards/hooks';
import { updateBoard } from './api';
import { updateCard } from '../cards/api';
import { boardKeys } from './query-keys';
import { revokeBoardAccess } from './revoke-board-access';
import {
  reduceBoardToReadOnly,
  receiveBoardRevocation,
} from '../realtime/access-revocation';
import type { Board } from './types';
import type { Card } from '../cards/types';

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'actor' },
    runAuthorized: <T,>(work: (token: string) => Promise<T>) => work('token'),
  }),
}));
vi.mock('../auth/auth-session-context', () => ({
  useAuthSession: () => ({ isCurrent: () => true, generation: 1 }),
}));
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  updateBoard: vi.fn(),
}));
vi.mock('../cards/api', async (original) => ({
  ...(await original<typeof import('../cards/api')>()),
  updateCard: vi.fn(),
}));

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('delayed mutation responses after Board access changes', () => {
  it.each(['revoke', 'downgrade'] as const)(
    'cannot restore OWNER capabilities after %s',
    async (transition) => {
      const client = new QueryClient();
      const board = makeBoard({ id: 'ABCD', currentUserRole: 'OWNER' });
      client.setQueryData(boardKeys.detail(board.id), board);
      const pending = deferred<Board>();
      vi.mocked(updateBoard).mockReturnValueOnce(pending.promise);
      const { result, unmount } = renderHook(() => useUpdateBoard(board.id), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      });
      let mutation: Promise<Board> | undefined;
      act(() => {
        mutation = result.current.mutateAsync({ name: 'Delayed' });
      });
      await waitFor(() => expect(vi.mocked(updateBoard)).toHaveBeenCalled());
      act(() =>
        transition === 'revoke'
          ? receiveBoardRevocation(client, { boardId: 'abcd' })
          : reduceBoardToReadOnly(client, 'abcd'),
      );
      await act(async () => {
        pending.resolve({ ...board, name: 'Delayed' });
        await mutation;
      });
      const cached = client.getQueryData<Board>(boardKeys.detail(board.id));
      if (transition === 'revoke') expect(cached).toBeUndefined();
      else
        expect(cached).toMatchObject({
          currentUserRole: null,
          capabilities: { canWriteBoard: false },
        });
      unmount();
      client.clear();
      vi.clearAllMocks();
    },
  );

  it('cannot recreate a protected Card cache after a late success', async () => {
    const client = new QueryClient();
    const board = makeBoard();
    const card = makeCard({ boardId: board.id });
    client.setQueryData(boardKeys.detail(board.id), board);
    client.setQueryData(boardKeys.card(board.id, card.id), card);
    const pending = deferred<Card>();
    vi.mocked(updateCard).mockReturnValueOnce(pending.promise);
    const { result, unmount } = renderHook(
      () => useUpdateCard(board.id, card.id),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    let mutation: Promise<Card> | undefined;
    act(() => {
      mutation = result.current.mutateAsync({ title: 'Delayed' });
    });
    await waitFor(() => expect(vi.mocked(updateCard)).toHaveBeenCalled());
    act(() => revokeBoardAccess(client, board.id));
    await act(async () => {
      pending.resolve({ ...card, title: 'Delayed' });
      await mutation;
    });
    expect(
      client.getQueryData(boardKeys.card(board.id, card.id)),
    ).toBeUndefined();
    expect(client.getQueryData(boardKeys.detail(board.id))).toBeUndefined();
    unmount();
    client.clear();
    vi.clearAllMocks();
  });
});
