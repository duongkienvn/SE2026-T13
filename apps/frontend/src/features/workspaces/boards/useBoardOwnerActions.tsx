import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BoardVisibility } from '@kanban/shared';
import { ApiError, isApiError } from '../../../lib/api-client';
import { useAuth } from '../../auth/useAuth';
import { useAuthSession } from '../../auth/auth-session-context';
import { getBoard } from '../../boards/api';
import {
  boardAccessVersion,
  boardGrantVersion,
} from '../../boards/access-version';
import { boardKeys } from '../../boards/query-keys';
import { revokeBoardAccess } from '../../boards/revoke-board-access';
import { workspaceKeys } from '../query-keys';
import { changeBoardVisibility, moveBoardToWorkspace } from '../settings/api';
import { BoardVisibilityDialog, MoveBoardDialog } from './BoardOwnerDialogs';
import { canUseBoardOwnerActions, type BoardOwnerActionModel } from './types';

export type BoardOwnerAction = 'visibility' | 'move';
interface Selection {
  board: BoardOwnerActionModel;
  action: BoardOwnerAction;
  contextId: string;
  grant: number;
}

/** Lives in the page, above data-dependent dialogs/cards that resync can unmount. */
export function useBoardOwnerActions(
  contextId: string,
  boards: readonly BoardOwnerActionModel[],
  onSaved?: (action: BoardOwnerAction) => void,
) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const latest = useRef({ boards, selection, contextId });
  latest.current = { boards, selection, contextId };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const client = useQueryClient();
  const current = (input: Selection, grant: number | undefined) =>
    scope.isCurrent() && grant === boardGrantVersion(client, input.board.id);
  const mutation = useMutation({
    retry: false,
    mutationFn: ({
      selected,
      board,
      value,
    }: {
      selected: Selection;
      board: BoardOwnerActionModel;
      value: string;
    }) => {
      if (!scope.isCurrent() || !canUseBoardOwnerActions(board))
        throw new ApiError(403, 'FORBIDDEN', 'Board action unavailable.');
      return runAuthorized((token) =>
        selected.action === 'visibility'
          ? changeBoardVisibility(token, board.id, value as BoardVisibility)
          : moveBoardToWorkspace(token, board.id, value),
      );
    },
    onMutate: ({ selected }) => ({
      access: boardAccessVersion(client, selected.board.id),
      grant: boardGrantVersion(client, selected.board.id),
    }),
    onSuccess: async (_saved, { selected }, version) => {
      const usable = () =>
        current(selected, version?.grant) &&
        mounted.current &&
        latest.current.contextId === selected.contextId &&
        latest.current.selection === selected;
      if (!usable()) return;
      const authority = latest.current.boards.find(
        (board) => board.id === selected.board.id,
      );
      if (authority && !canUseBoardOwnerActions(authority)) {
        setSelection(null);
        return;
      }
      // A general resync invalidates snapshots, not the committed command. A
      // fresh read must confirm OWNER authority before delivering completion.
      if (
        !authority ||
        version?.access !== boardAccessVersion(client, selected.board.id)
      ) {
        while (usable()) {
          const access = boardAccessVersion(client, selected.board.id);
          let fresh;
          try {
            fresh = await runAuthorized((token) =>
              getBoard(token, selected.board.id),
            );
          } catch (error) {
            if (!usable()) return;
            if (access !== boardAccessVersion(client, selected.board.id))
              continue;
            if (isApiError(error) && [403, 404].includes(error.status))
              revokeBoardAccess(client, selected.board.id);
            throw error;
          }
          if (!usable()) return;
          if (access !== boardAccessVersion(client, selected.board.id))
            continue;
          if (
            fresh.currentUserRole !== 'OWNER' ||
            fresh.isArchived ||
            fresh.capabilities?.canManageBoard !== true
          ) {
            setSelection(null);
            return;
          }
          break;
        }
      }
      if (!usable()) return;
      setSelection(null);
      onSaved?.(selected.action);
    },
    onSettled: (_saved, error, { selected, board, value }, version) => {
      if (!current(selected, version?.grant)) return;
      if (isApiError(error) && error.status === 404) {
        revokeBoardAccess(client, board.id);
        return;
      }
      for (const id of new Set([
        board.workspaceId,
        selected.action === 'move' ? value : undefined,
      ])) {
        if (id)
          void client.invalidateQueries({
            queryKey: workspaceKeys.resource(
              user?.id ?? '',
              scope.generation,
              id,
            ),
          });
      }
      if (selected.action === 'move')
        void client.invalidateQueries({
          queryKey: workspaceKeys.list(user?.id ?? '', scope.generation),
        });
      void client.invalidateQueries({ queryKey: boardKeys.detail(board.id) });
      void client.invalidateQueries({ queryKey: boardKeys.lists() });
    },
  });
  const board =
    selection && boards.find((item) => item.id === selection.board.id);
  const command = {
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
    submit: (value: string) => {
      if (
        selection &&
        board &&
        selection.grant === boardGrantVersion(client, board.id) &&
        canUseBoardOwnerActions(board) &&
        !mutation.isPending
      )
        mutation.mutate({ selected: selection, board, value });
    },
  };
  const dialog =
    selection &&
    selection.contextId === contextId &&
    board &&
    selection.grant === boardGrantVersion(client, board.id) &&
    canUseBoardOwnerActions(board) ? (
      selection.action === 'visibility' ? (
        <BoardVisibilityDialog
          board={board}
          command={command}
          onClose={() => setSelection(null)}
        />
      ) : (
        <MoveBoardDialog
          board={board}
          command={command}
          onClose={() => setSelection(null)}
        />
      )
    ) : null;
  return {
    open: (board: BoardOwnerActionModel, action: BoardOwnerAction) => {
      if (mutation.isPending && selection?.contextId === contextId) return;
      mutation.reset();
      setSelection({
        board,
        action,
        contextId,
        grant: boardGrantVersion(client, board.id),
      });
    },
    dialog,
  };
}
