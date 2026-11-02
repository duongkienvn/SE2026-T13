import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, isApiError } from '../../../lib/api-client';
import { StarIcon } from '../../../components/icons';
import { useAuth } from '../../auth/useAuth';
import { useAuthSession } from '../../auth/auth-session-context';
import { boardKeys } from '../query-keys';
import { workspaceKeys } from '../../workspaces/query-keys';
import { revokeBoardAccess } from '../revoke-board-access';
import { boardAccessVersion } from '../access-version';

type UserState = { isStarred: boolean; lastViewedAt: string | null };

export function BoardStar({
  boardId,
  boardName,
}: {
  boardId: string;
  boardName: string;
}) {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  const key = [
    'board-discovery',
    user?.id,
    scope.generation,
    'state',
    boardId,
  ] as const;
  const path = `/boards/${encodeURIComponent(boardId)}`;
  const state = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const accessVersion = boardAccessVersion(client, boardId);
      try {
        const result = await runAuthorized((accessToken) =>
          apiRequest<UserState>(`${path}/user-state`, { accessToken, signal }),
        );
        if (
          !scope.isCurrent() ||
          accessVersion !== boardAccessVersion(client, boardId)
        )
          throw new Error('Board access changed');
        return result;
      } catch (error) {
        if (
          scope.isCurrent() &&
          accessVersion === boardAccessVersion(client, boardId) &&
          isApiError(error) &&
          [403, 404].includes(error.status)
        )
          revokeBoardAccess(client, boardId);
        throw error;
      }
    },
    enabled: !!user,
    retry: false,
  });
  const toggle = useMutation({
    onMutate: async () => {
      const accessVersion = boardAccessVersion(client, boardId);
      await client.cancelQueries({ queryKey: key, exact: true });
      return accessVersion;
    },
    mutationFn: (starred: boolean) => {
      if (!scope.isCurrent()) throw new Error('Session changed');
      return runAuthorized((accessToken) =>
        apiRequest<UserState>(`${path}/star`, {
          accessToken,
          method: starred ? 'PUT' : 'DELETE',
        }),
      );
    },
    onSuccess: (result, _starred, accessVersion) => {
      if (
        !scope.isCurrent() ||
        accessVersion !== boardAccessVersion(client, boardId)
      )
        return;
      client.setQueryData(key, result);
      void client.invalidateQueries({ queryKey: boardKeys.lists() });
      void client.invalidateQueries({
        queryKey: workspaceKeys.session(user?.id ?? '', scope.generation),
      });
    },
    onError: (error, _starred, accessVersion) => {
      if (
        scope.isCurrent() &&
        accessVersion === boardAccessVersion(client, boardId) &&
        isApiError(error) &&
        [403, 404].includes(error.status)
      ) {
        client.removeQueries({ queryKey: key });
        revokeBoardAccess(client, boardId);
      }
    },
  });
  const starred = state.data?.isStarred ?? false;
  return (
    <span className="relative z-10 inline-flex flex-col items-center">
      <button
        type="button"
        aria-label={`${starred ? 'Remove from' : 'Add to'} starred: ${boardName}`}
        aria-pressed={starred}
        disabled={!state.data || state.isError || toggle.isPending}
        onClick={() => toggle.mutate(!starred)}
        className="grid size-11 place-items-center rounded-md bg-surface text-primary focus-visible:outline-2 focus-visible:outline-primary disabled:text-muted"
      >
        <StarIcon className={`size-5 ${starred ? 'fill-current' : ''}`} />
      </button>
      {state.isError && (
        <span className="text-xs text-danger">
          Star unavailable.{' '}
          <button
            type="button"
            aria-label={`Retry star status: ${boardName}`}
            disabled={state.isFetching}
            onClick={() => void state.refetch()}
            className="underline focus-visible:outline-2 focus-visible:outline-primary"
          >
            Retry
          </button>
        </span>
      )}
      {toggle.isError && (
        <span role="alert" className="text-xs text-danger">
          Star unavailable
        </span>
      )}
    </span>
  );
}
