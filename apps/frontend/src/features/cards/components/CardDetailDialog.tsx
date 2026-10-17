import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { LoadingState } from '../../../components/states';
import { TextAreaField } from '../../../components/TextAreaField';
import { TextField } from '../../../components/TextField';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { isApiError } from '../../../lib/api-client';
import { toFormErrors } from '../../../lib/form-errors';
import { formatRelativeTime } from '../../../lib/format';
import type { BoardMember } from '../../board-members/types';
import { CommentsSection } from '../../comments/CommentsSection';
import { useArchiveCard, useCard, useUpdateCard } from '../hooks';
import type { Card, UpdateCardRequest } from '../types';
import {
  CARD_DESCRIPTION_MAX_LENGTH,
  dueDateFromInput,
  dueDateToInput,
  normalizeCardDescription,
  validateCardDescription,
  validateCardTitle,
} from '../validation';
import { CardAssignees } from './CardAssignees';

const FIELD_LABELS = {
  title: 'Title',
  description: 'Description',
  dueDate: 'Due date',
};
type Field = keyof typeof FIELD_LABELS;

interface CardDetailDialogProps {
  boardId: string;
  cardId: string;
  /** The card as shown on the board, so the dialog opens without waiting. */
  initialCard?: Card;
  columnName?: string;
  members: BoardMember[];
  /** The board is archived: everything is view-only. */
  boardReadOnly: boolean;
  onClose: () => void;
}

export function CardDetailDialog({
  boardId,
  cardId,
  initialCard,
  columnName,
  members,
  boardReadOnly,
  onClose,
}: CardDetailDialogProps) {
  const query = useCard(boardId, cardId, initialCard);
  const update = useUpdateCard(boardId, cardId);
  const archive = useArchiveCard(boardId, cardId);
  const card = query.data;
  const busy = update.isPending || archive.isPending;

  if (!card) {
    const gone =
      isApiError(query.error) &&
      (query.error.status === 404 || query.error.status === 403);
    return (
      <Dialog open onClose={onClose} title="Card" size="wide">
        {query.isPending ? (
          <LoadingState label="Loading card…" />
        ) : (
          <div className="space-y-5">
            <Alert variant="error">
              {gone
                ? 'This card no longer exists, or you no longer have access to it.'
                : 'We couldn’t load this card. Check your connection and try again.'}
            </Alert>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    );
  }

  const readOnly = boardReadOnly || card.isArchived;
  const meta = [
    columnName && `In ${columnName}`,
    `Created ${formatRelativeTime(card.createdAt)}`,
    `Updated ${formatRelativeTime(card.updatedAt)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Dialog
      open
      onClose={onClose}
      title={card.title}
      description={meta}
      size="wide"
      dismissible={!busy}
    >
      {card.isArchived && (
        <div className="mb-5">
          <Alert variant="error">
            This card is archived. It can be viewed but no longer changed.
          </Alert>
        </div>
      )}
      <CardForm
        key={card.id}
        card={card}
        readOnly={readOnly}
        pending={update.isPending}
        onSubmit={(patch) => update.mutateAsync(patch)}
        onClose={onClose}
        side={
          <>
            <CardAssignees card={card} members={members} readOnly={readOnly} />
            {!readOnly && (
              <ArchiveCardSection
                pending={archive.isPending}
                error={
                  archive.isError
                    ? toFormErrors(archive.error, {}).formError
                    : undefined
                }
                onArchive={() =>
                  archive.mutate(undefined, { onSuccess: onClose })
                }
                onCancel={() => archive.reset()}
              />
            )}
          </>
        }
      />
      <CommentsSection
        key={`${boardId}:${cardId}`}
        boardId={boardId}
        cardId={cardId}
        members={members}
        readOnly={readOnly}
      />
    </Dialog>
  );
}

interface CardValues {
  title: string;
  description: string | null;
  dueDate: string | null;
}

const valuesOf = (card: Card): CardValues => ({
  title: card.title,
  description: card.description,
  dueDate: card.dueDate,
});

interface CardFormProps {
  card: Card;
  readOnly: boolean;
  pending: boolean;
  onSubmit: (patch: UpdateCardRequest) => Promise<Card>;
  onClose: () => void;
  /** Due date sits in the side column too; this content goes under it. */
  side: ReactNode;
}

function CardForm({
  card,
  readOnly,
  pending,
  onSubmit,
  onClose,
  side,
}: CardFormProps) {
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
  // What was last saved; edits are compared against it.
  const [saved, setSaved] = useState(() => valuesOf(card));
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? '');
  const [dueDay, setDueDay] = useState(dueDateToInput(card.dueDate));
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<Field, string>>
  >({});
  const [formError, setFormError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  // Only a changed day counts: re-saving the same day keeps the stored time.
  const dueChanged = dueDay !== dueDateToInput(saved.dueDate);
  const patch: UpdateCardRequest = {};
  if (title.trim() !== saved.title) patch.title = title.trim();
  if (normalizeCardDescription(description) !== saved.description)
    patch.description = normalizeCardDescription(description);
  if (dueChanged) patch.dueDate = dueDateFromInput(dueDay);
  const changed = Object.keys(patch).length > 0;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || readOnly || !changed) return;

    const errors = {
      title: validateCardTitle(title),
      description: validateCardDescription(description),
    };
    setFieldErrors(errors);
    setFormError(undefined);
    setNotice(undefined);
    if (errors.title || errors.description) {
      focusFirstInvalid();
      return;
    }

    try {
      const result = await onSubmit(patch);
      setSaved(valuesOf(result));
      setTitle(result.title);
      setDescription(result.description ?? '');
      setDueDay(dueDateToInput(result.dueDate));
      setNotice('Changes saved.');
    } catch (error) {
      const result = toFormErrors(error, FIELD_LABELS);
      setFieldErrors(result.fieldErrors);
      setFormError(result.formError);
      focusFirstInvalid();
    }
  };

  return (
    <form ref={formRef} noValidate onSubmit={handleSubmit}>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="space-y-5">
          <TextField
            label="Title"
            name="title"
            value={title}
            disabled={readOnly}
            onChange={(event) => setTitle(event.target.value)}
            error={fieldErrors.title}
          />
          <TextAreaField
            label="Description"
            name="description"
            rows={5}
            value={description}
            disabled={readOnly}
            hint={
              readOnly
                ? undefined
                : `Optional. Up to ${CARD_DESCRIPTION_MAX_LENGTH} characters.`
            }
            onChange={(event) => setDescription(event.target.value)}
            error={fieldErrors.description}
          />
        </div>
        <div className="space-y-6 md:border-l md:border-line md:pl-6">
          <div>
            <TextField
              label="Due date"
              name="dueDate"
              type="date"
              value={dueDay}
              disabled={readOnly}
              onChange={(event) => setDueDay(event.target.value)}
              error={fieldErrors.dueDate}
            />
            {!readOnly && dueDay && (
              <button
                type="button"
                onClick={() => setDueDay('')}
                className="mt-1.5 rounded-md text-[13px] text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
              >
                Clear due date
              </button>
            )}
          </div>
          {side}
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {formError && <Alert variant="error">{formError}</Alert>}
        {notice && !changed && <Alert variant="success">{notice}</Alert>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button type="submit" disabled={pending || !changed}>
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

interface ArchiveCardSectionProps {
  pending: boolean;
  error?: string;
  onArchive: () => void;
  onCancel: () => void;
}

/** Asks for confirmation in place: a second dialog would trap Escape twice. */
function ArchiveCardSection({
  pending,
  error,
  onArchive,
  onCancel,
}: ArchiveCardSectionProps) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        Archive card
      </Button>
    );
  }
  return (
    <div
      role="group"
      aria-label="Archive card"
      className="space-y-3 rounded-lg border border-danger/30 bg-danger/5 p-3"
    >
      <p className="text-sm text-ink">
        Archive this card? It disappears from the board for every member.
        Archived cards can’t be restored yet.
      </p>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" onClick={onArchive} disabled={pending}>
          {pending ? 'Archiving…' : 'Archive card'}
        </Button>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            onCancel();
            setConfirming(false);
          }}
        >
          Keep card
        </Button>
      </div>
    </div>
  );
}
