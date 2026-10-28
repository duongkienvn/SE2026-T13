import { useId, useRef, useState, type FormEvent } from 'react';
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

export interface BoardValues {
  name: string;
  description: string | null;
}

interface BoardFormProps {
  initial: BoardValues;
  submitLabel: string;
  pendingLabel: string;
  /** Edit mode: keep Save disabled until something changed. */
  requireChange?: boolean;
  /** True while the create/update request runs (the mutation's own state). */
  pending: boolean;
  onSubmit: (values: BoardValues) => Promise<unknown>;
  onCancel: () => void;
  disabledReason?: string;
}

export function BoardForm({
  initial,
  submitLabel,
  pendingLabel,
  requireChange = false,
  pending,
  onSubmit,
  onCancel,
  disabledReason,
}: BoardFormProps) {
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? '');
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<Field, string>>
  >({});
  const [formError, setFormError] = useState<string>();
  const submitting = useRef(false);
  const noticeId = useId();

  const values: BoardValues = {
    name: name.trim(),
    description: normalizeDescription(description),
  };
  const changed =
    values.name !== initial.name || values.description !== initial.description;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      pending ||
      submitting.current ||
      disabledReason ||
      (requireChange && !changed)
    )
      return;

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

    submitting.current = true;
    try {
      await onSubmit(values);
    } catch (error) {
      const result = toFormErrors(error, FIELD_LABELS);
      setFieldErrors(result.fieldErrors);
      setFormError(result.formError);
      focusFirstInvalid();
    } finally {
      submitting.current = false;
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
      {disabledReason && (
        <p
          id={noticeId}
          role="status"
          className="rounded-lg border border-line bg-app p-3 text-sm leading-relaxed text-muted"
        >
          {disabledReason}
        </p>
      )}
      <TextField
        label="Board name"
        name="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={fieldErrors.name}
        data-autofocus
        disabled={pending}
      />
      <TextAreaField
        label="Description"
        name="description"
        value={description}
        hint={`Optional. Up to ${BOARD_DESCRIPTION_MAX_LENGTH} characters.`}
        onChange={(event) => setDescription(event.target.value)}
        error={fieldErrors.description}
        disabled={pending}
      />
      <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={pending || !!disabledReason || (requireChange && !changed)}
          aria-describedby={disabledReason ? noticeId : undefined}
        >
          {pending
            ? pendingLabel
            : disabledReason
              ? 'Create unavailable'
              : submitLabel}
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

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create a new board"
      description="Start a new Kanban board for your project or team."
      dismissible={!create.isPending}
    >
      <BoardForm
        initial={{ name: '', description: null }}
        submitLabel="Create board"
        pendingLabel="Creating…"
        pending={create.isPending}
        onCancel={onClose}
        onSubmit={async (values) => onCreated(await create.mutateAsync(values))}
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
  const initial = { name: board.name, description: board.description };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit board"
      dismissible={!update.isPending}
    >
      <BoardForm
        initial={initial}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        requireChange
        pending={update.isPending}
        onCancel={onClose}
        onSubmit={async (values) => {
          // Send only what changed; the API rejects an empty update.
          const patch: UpdateBoardRequest = {};
          if (values.name !== initial.name) patch.name = values.name;
          if (values.description !== initial.description)
            patch.description = values.description;
          onSaved(await update.mutateAsync(patch));
        }}
      />
    </Dialog>
  );
}
