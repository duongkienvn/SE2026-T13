import { useState, type FormEvent } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { TextField } from '../../../components/TextField';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { toFormErrors } from '../../../lib/form-errors';
import { useCreateColumn, useRenameColumn } from '../hooks';
import type { Column } from '../types';
import { validateColumnName } from '../validation';

const FIELD_LABELS = { name: 'Column name' };

interface ColumnFormProps {
  initialName: string;
  submitLabel: string;
  pendingLabel: string;
  /** Rename: keep Save disabled until the name changed. */
  requireChange?: boolean;
  pending: boolean;
  onSubmit: (name: string) => Promise<unknown>;
  onCancel: () => void;
}

function ColumnForm({
  initialName,
  submitLabel,
  pendingLabel,
  requireChange = false,
  pending,
  onSubmit,
  onCancel,
}: ColumnFormProps) {
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
  const [name, setName] = useState(initialName);
  const [fieldError, setFieldError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const changed = name.trim() !== initialName;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || (requireChange && !changed)) return;

    const error = validateColumnName(name);
    setFieldError(error);
    setFormError(undefined);
    if (error) {
      focusFirstInvalid();
      return;
    }

    try {
      await onSubmit(name.trim());
    } catch (failure) {
      const result = toFormErrors(failure, FIELD_LABELS);
      setFieldError(result.fieldErrors.name);
      setFormError(result.formError);
      focusFirstInvalid();
    }
  };

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={handleSubmit}
      className="space-y-5"
    >
      {formError && <Alert variant="error">{formError}</Alert>}
      <TextField
        label="Column name"
        name="name"
        value={name}
        placeholder="For example, In Progress"
        onChange={(event) => setName(event.target.value)}
        error={fieldError}
        data-autofocus
      />
      <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || (requireChange && !changed)}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}

interface CreateColumnDialogProps {
  boardId: string;
  open: boolean;
  onClose: () => void;
}

export function CreateColumnDialog({
  boardId,
  open,
  onClose,
}: CreateColumnDialogProps) {
  const create = useCreateColumn(boardId);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a column"
      description="New columns are added at the end of the board."
      dismissible={!create.isPending}
    >
      <ColumnForm
        initialName=""
        submitLabel="Add column"
        pendingLabel="Adding…"
        pending={create.isPending}
        onCancel={onClose}
        onSubmit={async (name) => {
          await create.mutateAsync({ name });
          onClose();
        }}
      />
    </Dialog>
  );
}

interface RenameColumnDialogProps {
  column: Column;
  open: boolean;
  onClose: () => void;
}

export function RenameColumnDialog({
  column,
  open,
  onClose,
}: RenameColumnDialogProps) {
  const rename = useRenameColumn(column.boardId);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Rename column"
      dismissible={!rename.isPending}
    >
      <ColumnForm
        initialName={column.name}
        submitLabel="Save"
        pendingLabel="Saving…"
        requireChange
        pending={rename.isPending}
        onCancel={onClose}
        onSubmit={async (name) => {
          await rename.mutateAsync({ columnId: column.id, name });
          onClose();
        }}
      />
    </Dialog>
  );
}
