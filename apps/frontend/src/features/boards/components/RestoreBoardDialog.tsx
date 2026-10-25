import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { toFormErrors } from '../../../lib/form-errors';
import { useRestoreBoard } from '../hooks';
import type { Board } from '../types';

interface RestoreBoardDialogProps {
  board: Board;
  open: boolean;
  onClose: () => void;
  onRestored: (board: Board) => void;
}

export function RestoreBoardDialog({
  board,
  open,
  onClose,
  onRestored,
}: RestoreBoardDialogProps) {
  const restore = useRestoreBoard(board.id);
  const error = restore.isError
    ? toFormErrors(restore.error, {}).formError
    : undefined;
  return (
    <ConfirmDialog
      open={open}
      title={`Restore “${board.name}”?`}
      description="The board will return to Active with its columns, cards, comments, and members. Archived cards remain archived."
      confirmLabel="Restore board"
      confirmVariant="primary"
      pendingLabel="Restoring…"
      pending={restore.isPending}
      error={error}
      onCancel={() => {
        restore.reset();
        onClose();
      }}
      onConfirm={() => restore.mutate(undefined, { onSuccess: onRestored })}
    />
  );
}
