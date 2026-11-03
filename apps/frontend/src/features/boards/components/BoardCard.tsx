import { ActionMenu } from '../../../components/ActionMenu';
import type { Board } from '../types';
import { BoardTile } from './BoardTile';

interface BoardCardProps {
  board: Board;
  stateUpdatedAt?: number;
  /** OWNER-only actions; omitted for members. */
  onEdit?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
}

export function BoardCard({
  board,
  stateUpdatedAt,
  onEdit,
  onArchive,
  onRestore,
}: BoardCardProps) {
  const actions = [
    onEdit && { label: 'Edit board', onSelect: onEdit },
    onArchive && {
      label: 'Archive board',
      onSelect: onArchive,
      tone: 'danger' as const,
    },
    onRestore && { label: 'Restore board', onSelect: onRestore },
  ].filter((item) => !!item);

  return (
    <BoardTile
      board={board}
      stateUpdatedAt={stateUpdatedAt}
      navigationLabel={board.name}
      actions={
        actions.length > 0 ? (
          <ActionMenu label={`Actions for ${board.name}`} items={actions} />
        ) : undefined
      }
    />
  );
}
