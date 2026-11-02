import type { ReactNode } from 'react';
import type { WorkspaceBoardSummary } from './types';
import { BoardTile } from '../../boards/components/BoardTile';

export function WorkspaceBoardCard({
  board,
  actions,
  stateUpdatedAt,
}: {
  board: WorkspaceBoardSummary;
  actions?: ReactNode;
  stateUpdatedAt?: number;
}) {
  return (
    <BoardTile
      board={board}
      actions={actions}
      stateUpdatedAt={stateUpdatedAt}
    />
  );
}
