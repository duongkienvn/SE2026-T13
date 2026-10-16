import { useMemo, useState } from 'react';
import { Button } from '../../../components/Button';
import { PlusIcon } from '../../../components/icons';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../../components/states';
import { useBoardMembers } from '../../board-members/hooks';
import type { MemberUser } from '../../board-members/types';
import { CardDetailDialog } from '../../cards/components/CardDetailDialog';
import { useCards } from '../../cards/hooks';
import type { Card } from '../../cards/types';
import { groupCardsByColumn } from '../../cards/ordering';
import {
  CreateColumnDialog,
  RenameColumnDialog,
} from '../../columns/components/ColumnFormDialog';
import { DeleteColumnDialog } from '../../columns/components/DeleteColumnDialog';
import {
  KanbanColumn,
  type ColumnActions,
} from '../../columns/components/KanbanColumn';
import { useColumns } from '../../columns/hooks';
import type { Column } from '../../columns/types';

interface KanbanBoardProps {
  boardId: string;
  /** Archived boards can be viewed but not changed. */
  readOnly: boolean;
}

type OpenDialog =
  | { kind: 'create-column' }
  | { kind: 'rename-column'; column: Column }
  | { kind: 'delete-column'; column: Column }
  | { kind: 'card'; cardId: string };

/** The board's columns and active cards, side by side. */
export function KanbanBoard({ boardId, readOnly }: KanbanBoardProps) {
  const columns = useColumns(boardId);
  const cards = useCards(boardId);
  // Only for assignee names and avatars: the board still shows without them.
  const members = useBoardMembers(boardId);
  const [dialog, setDialog] = useState<OpenDialog>();
  const closeDialog = () => setDialog(undefined);

  const membersById = useMemo(
    () =>
      new Map<string, MemberUser>(
        (members.data ?? []).map((member) => [member.user.id, member.user]),
      ),
    [members.data],
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
  const openCard = (card: Card) => setDialog({ kind: 'card', cardId: card.id });
  const openedCard =
    dialog?.kind === 'card'
      ? cards.data?.find((card) => card.id === dialog.cardId)
      : undefined;

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
      <div className="relative -mx-4 h-full overflow-x-auto px-4 md:-mx-6 md:px-6 lg:-mx-10 lg:px-10">
        <div className="flex h-full items-start gap-4 pb-1">
          {groups.map(({ column, cards: columnCards }) => (
            <KanbanColumn
              key={column.id}
              column={column}
              cards={columnCards}
              members={membersById}
              actions={columnActions}
              onOpenCard={openCard}
            />
          ))}
          {!readOnly && (
            <button
              type="button"
              onClick={openCreateColumn}
              className="flex w-70 shrink-0 items-center gap-2 rounded-xl border border-dashed border-line px-4 py-4 text-[15px] font-medium text-muted hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
            >
              <PlusIcon aria-hidden="true" className="size-4.5" />
              Add column
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {content}
      {dialog?.kind === 'create-column' && (
        <CreateColumnDialog boardId={boardId} open onClose={closeDialog} />
      )}
      {dialog?.kind === 'rename-column' && (
        <RenameColumnDialog column={dialog.column} open onClose={closeDialog} />
      )}
      {dialog?.kind === 'delete-column' && (
        <DeleteColumnDialog column={dialog.column} open onClose={closeDialog} />
      )}
      {dialog?.kind === 'card' && (
        <CardDetailDialog
          boardId={boardId}
          cardId={dialog.cardId}
          initialCard={openedCard}
          columnName={
            columns.data?.find((column) => column.id === openedCard?.columnId)
              ?.name
          }
          members={members.data ?? []}
          boardReadOnly={readOnly}
          onClose={closeDialog}
        />
      )}
    </>
  );
}
