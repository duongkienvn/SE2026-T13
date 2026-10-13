import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { toFormErrors } from '../../../lib/form-errors';
import { useArchiveBoard } from '../hooks';
import type { Board } from '../types';

interface ArchiveBoardDialogProps {
  board: Board;
  open: boolean;
  onClose: () => void;
  onArchived: (board: Board) => void;
}

export function ArchiveBoardDialog({
  board,
  open,
  onClose,
  onArchived,
}: ArchiveBoardDialogProps) {
  const archive = useArchiveBoard(board.id);
  const error = archive.isError
    ? toFormErrors(archive.error, {}).formError
    : undefined;

  return (
    <ConfirmDialog
      open={open}
      title={`Archive “${board.name}”?`}
      description="The board will disappear from the boards list for every member. Its data is kept, but archived boards can’t be restored yet."
      confirmLabel="Archive board"
      pendingLabel="Archiving…"
      pending={archive.isPending}
      error={error}
      onCancel={() => {
        archive.reset();
        onClose();
      }}
      onConfirm={() =>
        archive.mutate(undefined, { onSuccess: (saved) => onArchived(saved) })
      }
    />
  );
}
