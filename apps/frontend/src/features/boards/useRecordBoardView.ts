import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, isApiError } from '../../lib/api-client';
import { useAuth } from '../auth/useAuth';
import { useAuthSession } from '../auth/auth-session-context';
import { workspaceKeys } from '../workspaces/query-keys';
import { boardKeys } from './query-keys';
import { revokeBoardAccess } from './revoke-board-access';
import { boardAccessVersion } from './access-version';

export function useRecordBoardView(boardId: string, enabled: boolean) {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  const recorded = useRef('');
  const failed = useRef('');
  useEffect(() => {
    const visit = `${scope.generation}:${boardId}`;
    if (!enabled || !user) return;
    const record = () => {
      if (recorded.current === visit || !scope.isCurrent()) return;
      recorded.current = visit;
      const accessVersion = boardAccessVersion(client, boardId);
      void runAuthorized((accessToken) =>
        apiRequest(`/boards/${encodeURIComponent(boardId)}/views`, {
          method: 'POST',
          accessToken,
        }),
      )
        .then(() => {
          if (
            !scope.isCurrent() ||
            accessVersion !== boardAccessVersion(client, boardId)
          )
            return;
          if (failed.current === visit) failed.current = '';
          void client.invalidateQueries({
            queryKey: [
              'board-discovery',
              user.id,
              scope.generation,
              'state',
              boardId,
            ],
          });
          void client.invalidateQueries({ queryKey: boardKeys.lists() });
          void client.invalidateQueries({
            queryKey: workspaceKeys.session(user.id, scope.generation),
          });
        })
        .catch((error: unknown) => {
          if (
            !scope.isCurrent() ||
            accessVersion !== boardAccessVersion(client, boardId)
          )
            return;
          if (isApiError(error) && [403, 404].includes(error.status))
            revokeBoardAccess(client, boardId);
          else failed.current = visit;
        });
    };
    record();
    const retry = () => {
      if (failed.current !== visit) return;
      failed.current = '';
      recorded.current = '';
      record();
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [boardId, client, enabled, runAuthorized, scope, user]);
}
