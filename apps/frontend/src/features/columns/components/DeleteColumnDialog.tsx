import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { isApiError } from '../../../lib/api-client';
import { toFormErrors } from '../../../lib/form-errors';
import { COLUMN_NOT_EMPTY, useDeleteColumn } from '../hooks';
import type { Column } from '../types';

interface DeleteColumnDialogProps {
  column: Column;
  open: boolean;
  onClose: () => void;
}

function deleteError(error: unknown): string | undefined {
  if (!error) return undefined;
  // The backend counts archived cards too, which the board doesn't show.
  if (isApiError(error) && error.code === COLUMN_NOT_EMPTY) {
    return 'This column still has cards (including archived ones), so it can’t be deleted.';
  }
  return toFormErrors(error, {}).formError;
}

export function DeleteColumnDialog({
  column,
  open,
  onClose,
}: DeleteColumnDialogProps) {
  const remove = useDeleteColumn(column.boardId);
  return (
    <ConfirmDialog
      open={open}
      title={`Delete “${column.name}”?`}
      description="The column is removed from the board for every member. This can’t be undone."
      confirmLabel="Delete column"
      pendingLabel="Deleting…"
      pending={remove.isPending}
      error={remove.isError ? deleteError(remove.error) : undefined}
      onCancel={() => {
        remove.reset();
        onClose();
      }}
      onConfirm={() => remove.mutate(column.id, { onSuccess: onClose })}
    />
  );
}
