import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ActionMenu } from '../../../components/ActionMenu';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { ApiError, isApiError } from '../../../lib/api-client';
import { useAuth } from '../../auth/useAuth';
import { useAuthSession } from '../../auth/auth-session-context';
import { archiveBoard, restoreBoard } from '../../boards/api';
import { boardKeys } from '../../boards/query-keys';
import { revokeBoardAccess } from '../../boards/revoke-board-access';
import { boardAccessVersion } from '../../boards/access-version';
import { workspaceKeys } from '../query-keys';
import type { WorkspaceOverview } from '../types';
import type { BoardOwnerActionModel, WorkspaceBoardSummary } from './types';
import type { BoardOwnerAction } from './useBoardOwnerActions';

/** Board OWNER and archive state, independent of Workspace ADMIN. */
export function WorkspaceBoardActions({
  board,
  workspaceId,
  onOwnerAction,
}: {
  board: WorkspaceBoardSummary;
  workspaceId: string;
  onOwnerAction: (
    board: BoardOwnerActionModel,
    action: BoardOwnerAction,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  const allowed =
    board.currentUserRole === 'OWNER' &&
    (board.isArchived ? board.canRestore : board.canArchive);
  const action = board.isArchived ? 'Restore' : 'Archive';
  const mutation = useMutation({
    mutationFn: () => {
      if (!allowed || !scope.isCurrent())
        throw new ApiError(403, 'FORBIDDEN', 'Board action unavailable.');
      return runAuthorized((token) =>
        (board.isArchived ? restoreBoard : archiveBoard)(token, board.id),
      );
    },
    onMutate: () => boardAccessVersion(client, board.id),
    onSuccess: (saved, _input, version) => {
      if (
        !scope.isCurrent() ||
        version !== boardAccessVersion(client, board.id)
      )
        return;
      client.setQueryData(boardKeys.detail(saved.id), saved);
      void client.invalidateQueries({ queryKey: boardKeys.lists() });
      void client.invalidateQueries({
        queryKey: workspaceKeys.resource(
          user?.id ?? '',
          scope.generation,
          workspaceId,
        ),
      });
      setOpen(false);
    },
    onError: async (error) => {
      if (scope.isCurrent() && isApiError(error) && error.status === 409) {
        void client.invalidateQueries({ queryKey: boardKeys.detail(board.id) });
        void client.invalidateQueries({
          queryKey: workspaceKeys.resource(
            user?.id ?? '',
            scope.generation,
            workspaceId,
          ),
        });
        return;
      }
      if (
        !scope.isCurrent() ||
        !isApiError(error) ||
        ![403, 404].includes(error.status)
      )
        return;
      revokeBoardAccess(client, board.id);
      const queryKey = workspaceKeys.boards(
        user?.id ?? '',
        scope.generation,
        workspaceId,
      );
      const overviewKey = workspaceKeys.overview(
        user?.id ?? '',
        scope.generation,
        workspaceId,
      );
      await Promise.all([
        client.cancelQueries({ queryKey }),
        client.cancelQueries({ queryKey: overviewKey }),
      ]);
      if (!scope.isCurrent()) return;
      for (const query of client.getQueryCache().findAll({ queryKey }))
        query.setState({
          data: null,
          status: 'error',
          error: new ApiError(
            409,
            'BOARD_ACCESS_CHANGED',
            'Board access changed. Reload boards.',
          ),
        });
      // A previously readable Board may also exist in the shared Overview.
      // Hide recents/count until a fresh ACL-filtered response confirms access.
      client.setQueryData<WorkspaceOverview>(overviewKey, (current) =>
        current
          ? { ...current, recentBoards: [], visibleBoardCount: null }
          : current,
      );
      void client.invalidateQueries({ queryKey: overviewKey });
    },
  });
  // Explicit Board OWNER only, never inferred from Workspace ADMIN.
  const ownsActive = board.currentUserRole === 'OWNER' && !board.isArchived;
  const ownerBoard = { ...board, workspaceId, canManageBoard: ownsActive };
  if (!allowed && !ownsActive) return null;
  return (
    <>
      <ActionMenu
        label={`Actions for ${board.name}`}
        className="[&>button]:size-11 [&_button]:min-h-11"
        items={[
          ...(ownsActive
            ? [
                {
                  label: 'Change visibility',
                  onSelect: () => onOwnerAction(ownerBoard, 'visibility'),
                },
                {
                  label: 'Move to workspace',
                  onSelect: () => onOwnerAction(ownerBoard, 'move'),
                },
              ]
            : []),
          ...(allowed
            ? [
                {
                  label: `${action} board`,
                  tone: (board.isArchived ? 'default' : 'danger') as
                    'default' | 'danger',
                  onSelect: () => {
                    mutation.reset();
                    setOpen(true);
                  },
                },
              ]
            : []),
        ]}
      />
      <ConfirmDialog
        open={open}
        title={`${action} “${board.name}”?`}
        description={
          board.isArchived
            ? 'The board will return to Active with its columns, cards, comments, and members. Archived cards remain archived.'
            : 'This board will become read only for every member. Its data is kept, and an authorized Board owner can restore it later.'
        }
        confirmLabel={`${action} board`}
        pendingLabel={board.isArchived ? 'Restoring…' : 'Archiving…'}
        pending={mutation.isPending}
        confirmVariant={board.isArchived ? 'primary' : 'danger'}
        error={
          mutation.isError
            ? 'Could not update the board. Please try again.'
            : undefined
        }
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          if (!mutation.isPending) mutation.mutate();
        }}
      />
    </>
  );
}
