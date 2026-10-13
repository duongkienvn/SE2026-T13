import { useState, type FormEvent } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { TextAreaField } from '../../../components/TextAreaField';
import { TextField } from '../../../components/TextField';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { toFormErrors } from '../../../lib/form-errors';
import { useCreateBoard, useUpdateBoard } from '../hooks';
import type { Board, UpdateBoardRequest } from '../types';
import {
  BOARD_DESCRIPTION_MAX_LENGTH,
  normalizeDescription,
  validateBoardDescription,
  validateBoardName,
} from '../validation';

const FIELD_LABELS = { name: 'Board name', description: 'Description' };
type Field = keyof typeof FIELD_LABELS;

interface BoardValues {
  name: string;
  description: string | null;
}

interface BoardFormProps {
  initial: BoardValues;
  submitLabel: string;
  pendingLabel: string;
  /** Edit mode: keep Save disabled until something changed. */
  requireChange?: boolean;
  onSubmit: (values: BoardValues) => Promise<unknown>;
  onCancel: () => void;
  onPendingChange: (pending: boolean) => void;
}

function BoardForm({
  initial,
  submitLabel,
  pendingLabel,
  requireChange = false,
  onSubmit,
  onCancel,
  onPendingChange,
}: BoardFormProps) {
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? '');
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<Field, string>>
  >({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);

  const values: BoardValues = {
    name: name.trim(),
    description: normalizeDescription(description),
  };
  const changed =
    values.name !== initial.name || values.description !== initial.description;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || (requireChange && !changed)) return;

    const errors = {
      name: validateBoardName(name),
      description: validateBoardDescription(description),
    };
    setFieldErrors(errors);
    setFormError(undefined);
    if (errors.name || errors.description) {
      focusFirstInvalid();
      return;
    }

    setPending(true);
    onPendingChange(true);
    try {
      await onSubmit(values);
    } catch (error) {
      const result = toFormErrors(error, FIELD_LABELS);
      setFieldErrors(result.fieldErrors);
      setFormError(result.formError);
      focusFirstInvalid();
      setPending(false);
      onPendingChange(false);
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
        label="Board name"
        name="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={fieldErrors.name}
        data-autofocus
      />
      <TextAreaField
        label="Description"
        name="description"
        value={description}
        hint={`Optional. Up to ${BOARD_DESCRIPTION_MAX_LENGTH} characters.`}
        onChange={(event) => setDescription(event.target.value)}
        error={fieldErrors.description}
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

interface CreateBoardDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (board: Board) => void;
}

export function CreateBoardDialog({
  open,
  onClose,
  onCreated,
}: CreateBoardDialogProps) {
  const create = useCreateBoard();
  const [pending, setPending] = useState(false);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create a new board"
      description="Start a new Kanban board for your project or team."
      dismissible={!pending}
    >
      <BoardForm
        initial={{ name: '', description: null }}
        submitLabel="Create board"
        pendingLabel="Creating…"
        onPendingChange={setPending}
        onCancel={onClose}
        onSubmit={async (values) => {
          const board = await create.mutateAsync(values);
          setPending(false);
          onCreated(board);
        }}
      />
    </Dialog>
  );
}

interface EditBoardDialogProps {
  board: Board;
  open: boolean;
  onClose: () => void;
  onSaved: (board: Board) => void;
}

export function EditBoardDialog({
  board,
  open,
  onClose,
  onSaved,
}: EditBoardDialogProps) {
  const update = useUpdateBoard(board.id);
  const [pending, setPending] = useState(false);
  const initial = { name: board.name, description: board.description };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit board"
      dismissible={!pending}
    >
      <BoardForm
        initial={initial}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        requireChange
        onPendingChange={setPending}
        onCancel={onClose}
        onSubmit={async (values) => {
          // Send only what changed; the API rejects an empty update.
          const patch: UpdateBoardRequest = {};
          if (values.name !== initial.name) patch.name = values.name;
          if (values.description !== initial.description)
            patch.description = values.description;
          const saved = await update.mutateAsync(patch);
          setPending(false);
          onSaved(saved);
        }}
      />
    </Dialog>
  );
}
