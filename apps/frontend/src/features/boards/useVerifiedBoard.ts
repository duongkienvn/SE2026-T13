import { useEffect, useState } from 'react';
import { useAuthSession } from '../auth/auth-session-context';
import { useBoard } from './hooks';

/** A cached Board is usable only after a successful check in this mounted session. */
export function useVerifiedBoard(boardId: string | undefined) {
  const { generation } = useAuthSession();
  const board = useBoard(boardId ?? '', { enabled: !!boardId });
  const key = `${generation}:${boardId ?? ''}`;
  const [confirmed, setConfirmed] = useState<string>();
  const successfulCheck = board.isSuccess && board.isFetchedAfterMount;
  const verified = confirmed === key || successfulCheck;
  useEffect(() => {
    if (successfulCheck) setConfirmed(key);
  }, [successfulCheck, key]);
  return { board, verified };
}
