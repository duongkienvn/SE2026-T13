import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../../components/Button';
import { PlusIcon } from '../../../components/icons';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../../components/states';
import { isApiError } from '../../../lib/api-client';
import { useBoardMembers } from '../../board-members/hooks';
import type { MemberUser } from '../../board-members/types';
import { CardDetailDialog } from '../../cards/components/CardDetailDialog';
import { useCards } from '../../cards/hooks';
import { useCardRoute } from '../../cards/useCardRoute';
import type { Card } from '../../cards/types';
import { groupCardsByColumn } from '../../cards/ordering';
import {
  CreateColumnDialog,
  RenameColumnDialog,
} from '../../columns/components/ColumnFormDialog';
import { DeleteColumnDialog } from '../../columns/components/DeleteColumnDialog';
import type { ColumnActions } from '../../columns/components/KanbanColumn';
import { useColumns } from '../../columns/hooks';
import type { Column } from '../../columns/types';
import { boardKeys } from '../query-keys';
import { KanbanDndBoard } from './KanbanDndBoard';

interface KanbanBoardProps {
  boardId: string;
  /** Archived boards can be viewed but not changed. */
  readOnly: boolean;
  canReadMembers?: boolean;
}

type OpenDialog =
  | { kind: 'create-column' }
  | { kind: 'rename-column'; column: Column }
  | { kind: 'delete-column'; column: Column };

/** The board's columns and active cards, side by side. */
export function KanbanBoard({
  boardId,
  readOnly,
  canReadMembers = true,
}: KanbanBoardProps) {
  const { cardId, openCard, closeCard } = useCardRoute(boardId);
  const columns = useColumns(boardId);
  const cards = useCards(boardId);
  // Only for assignee names and avatars: the board still shows without them.
  const members = useBoardMembers(boardId, { enabled: canReadMembers });
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<OpenDialog>();

  // 403/404 here means access was lost or the board is gone. Cached columns
  // and cards would keep it on screen, so refetch the board itself: the page
  // then shows "Board not found". Only the board (`exact`), not this data.
  const lostAccess = [columns.error, cards.error].some(
    (error) =>
      isApiError(error) && (error.status === 403 || error.status === 404),
  );
  useEffect(() => {
    if (!lostAccess) return;
    void queryClient.invalidateQueries({
      queryKey: boardKeys.detail(boardId),
      exact: true,
    });
  }, [lostAccess, boardId, queryClient]);
  const closeDialog = () => setDialog(undefined);

  const membersById = useMemo(
    () =>
      new Map<string, MemberUser>(
        (canReadMembers ? (members.data ?? []) : []).map((member) => [
          member.user.id,
          member.user,
        ]),
      ),
    [members.data, canReadMembers],
  );
  const groups = useMemo(
    () => groupCardsByColumn(columns.data ?? [], cards.data ?? []),
    [columns.data, cards.data],
  );
  const columnActions: ColumnActions | undefined = readOnly
    ? undefined
    : {
        onRename: (column) => setDialog({ kind: 'rename-column', column }),
        onDelete: (column) => setDialog({ kind: 'delete-column', column }),
      };
  const openCreateColumn = () => setDialog({ kind: 'create-column' });
  const openedCard = cards.data?.find((card) => card.id === cardId);

  let content;
  if (columns.isPending || cards.isPending) {
    content = <LoadingState label="Loading columns and cards…" />;
  } else if (!columns.data || !cards.data) {
    // A failed background refresh keeps the loaded board on screen.
    content = (
      <ErrorState
        title="We couldn't load this board's cards"
        description="Check your connection and try again."
        onRetry={() => {
          if (columns.isError) void columns.refetch();
          if (cards.isError) void cards.refetch();
        }}
      />
    );
  } else if (groups.length === 0) {
    content = (
      <EmptyState
        title="No columns yet"
        description="Columns hold this board's cards, such as To Do, In Progress and Done."
        action={
          !readOnly && (
            <Button onClick={openCreateColumn}>
              <PlusIcon aria-hidden="true" className="size-4.5" />
              Add column
            </Button>
          )
        }
      />
    );
  } else {
    content = (
      <KanbanDndBoard
        boardId={boardId}
        groups={groups}
        members={membersById}
        actions={columnActions}
        onOpenCard={(card: Card) => openCard(card.id)}
        trailing={
          !readOnly && (
            <button
              type="button"
              onClick={openCreateColumn}
              className="flex w-70 shrink-0 items-center gap-2 rounded-xl border border-dashed border-line px-4 py-4 text-[15px] font-medium text-muted hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
            >
              <PlusIcon aria-hidden="true" className="size-4.5" />
              Add column
            </button>
          )
        }
      />
    );
  }

  return (
    <>
      {content}
      {!readOnly && dialog?.kind === 'create-column' && (
        <CreateColumnDialog boardId={boardId} open onClose={closeDialog} />
      )}
      {!readOnly && dialog?.kind === 'rename-column' && (
        <RenameColumnDialog column={dialog.column} open onClose={closeDialog} />
      )}
      {!readOnly && dialog?.kind === 'delete-column' && (
        <DeleteColumnDialog column={dialog.column} open onClose={closeDialog} />
      )}
      {cardId && (
        <CardDetailDialog
          key={`${boardId}:${cardId}`}
          boardId={boardId}
          cardId={cardId}
          initialCard={openedCard}
          columnName={
            columns.data?.find((column) => column.id === openedCard?.columnId)
              ?.name
          }
          members={canReadMembers ? (members.data ?? []) : []}
          canReadMembers={canReadMembers}
          boardReadOnly={readOnly}
          onClose={closeCard}
        />
      )}
    </>
  );
}
