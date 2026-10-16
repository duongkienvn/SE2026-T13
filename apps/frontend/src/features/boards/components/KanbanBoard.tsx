import { useMemo } from 'react';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../../components/states';
import { useBoardMembers } from '../../board-members/hooks';
import type { MemberUser } from '../../board-members/types';
import { useCards } from '../../cards/hooks';
import { groupCardsByColumn } from '../../cards/ordering';
import { KanbanColumn } from '../../columns/components/KanbanColumn';
import { useColumns } from '../../columns/hooks';

interface KanbanBoardProps {
  boardId: string;
}

/** The board's columns and active cards, side by side. */
export function KanbanBoard({ boardId }: KanbanBoardProps) {
  const columns = useColumns(boardId);
  const cards = useCards(boardId);
  // Only for assignee names and avatars: the board still shows without them.
  const members = useBoardMembers(boardId);

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

  if (columns.isPending || cards.isPending) {
    return <LoadingState label="Loading columns and cards…" />;
  }
  // A failed background refresh keeps the loaded board on screen.
  if (!columns.data || !cards.data) {
    return (
      <ErrorState
        title="We couldn't load this board's cards"
        description="Check your connection and try again."
        onRetry={() => {
          if (columns.isError) void columns.refetch();
          if (cards.isError) void cards.refetch();
        }}
      />
    );
  }
  if (groups.length === 0) {
    return (
      <EmptyState
        title="No columns yet"
        description="Columns hold this board's cards, such as To Do, In Progress and Done."
      />
    );
  }

  return (
    <div className="relative -mx-4 h-full overflow-x-auto px-4 md:-mx-6 md:px-6 lg:-mx-10 lg:px-10">
      <div className="flex h-full items-start gap-4 pb-1">
        {groups.map(({ column, cards: columnCards }) => (
          <KanbanColumn
            key={column.id}
            column={column}
            cards={columnCards}
            members={membersById}
          />
        ))}
      </div>
    </div>
  );
}
