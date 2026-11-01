import { useState, type FormEvent } from 'react';
import { Alert } from '../../../../components/Alert';
import { Button } from '../../../../components/Button';
import { TextAreaField } from '../../../../components/TextAreaField';
import { TextField } from '../../../../components/TextField';
import { PencilIcon, TextIcon } from '../../../../components/icons';
import { toFormErrors } from '../../../../lib/form-errors';
import { isFieldDirty, type CardDraft } from '../../card-draft';
import { useUpdateCard } from '../../hooks';
import type { Card } from '../../types';
import {
  CARD_DESCRIPTION_MAX_LENGTH,
  normalizeCardDescription,
  validateCardDescription,
  validateCardTitle,
} from '../../validation';
import { CardDetailSection, sectionActionClass } from './CardDetailSection';

interface FieldEditorProps<F extends 'title' | 'description'> {
  card: Card;
  draft: CardDraft[F];
  onDraft: (value: CardDraft[F]) => void;
  readOnly: boolean;
}

/** Shown when the server value moved on while the user was editing. */
function RemoteChange({ what, onLoad }: { what: string; onLoad: () => void }) {
  return (
    <Alert variant="error">
      <p>
        Someone else changed the {what} while you were editing. Saving replaces
        their version with yours.
      </p>
      <button
        type="button"
        onClick={onLoad}
        className="mt-1 font-medium text-primary underline"
      >
        Discard mine and load theirs
      </button>
    </Alert>
  );
}

/** Kept text after the card turned read-only, so nothing typed is lost silently. */
function StrandedDraft({
  what,
  value,
  onDiscard,
}: {
  what: string;
  value: string;
  onDiscard: () => void;
}) {
  return (
    <div className="space-y-3">
      <Alert variant="error">
        This card can no longer be changed. Your unsaved {what} is kept below so
        you can copy it.
      </Alert>
      <TextAreaField
        label={`Unsaved ${what}`}
        value={value}
        readOnly
        rows={3}
      />
      <Button variant="secondary" size="sm" onClick={onDiscard}>
        Discard unsaved {what}
      </Button>
    </div>
  );
}

function useFieldSave(card: Card) {
  const update = useUpdateCard(card.boardId, card.id);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  return { update, error, setError, notice, setNotice };
}

export function TitleEditor({
  card,
  draft,
  onDraft,
  readOnly,
}: FieldEditorProps<'title'>) {
  const { update, error, setError } = useFieldSave(card);
  const [fieldError, setFieldError] = useState<string>();
  if (!draft) return null;
  if (readOnly)
    return isFieldDirty({ title: draft }, 'title') ? (
      <StrandedDraft
        what="title"
        value={draft.value}
        onDiscard={() => onDraft(undefined)}
      />
    ) : null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (update.isPending) return;
    const invalid = validateCardTitle(draft.value);
    setFieldError(invalid);
    setError(undefined);
    if (invalid) return;
    const title = draft.value.trim();
    if (title === card.title) {
      onDraft(undefined);
      return;
    }
    try {
      await update.mutateAsync({ title });
      onDraft(undefined);
    } catch (failure) {
      const result = toFormErrors(failure, { title: 'Title' });
      setFieldError(result.fieldErrors.title);
      setError(result.formError);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      className="space-y-3 rounded-xl border border-line p-3 sm:p-4"
    >
      {draft.base !== card.title && (
        <RemoteChange
          what="title"
          onLoad={() => onDraft({ base: card.title, value: card.title })}
        />
      )}
      <TextField
        label="Title"
        name="title"
        autoFocus
        value={draft.value}
        error={fieldError}
        onChange={(event) =>
          onDraft({ ...draft, value: event.currentTarget.value })
        }
      />
      {error && <Alert variant="error">{error}</Alert>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={update.isPending}
          onClick={() => onDraft(undefined)}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save title'}
        </Button>
      </div>
    </form>
  );
}

export function DescriptionSection({
  card,
  draft,
  onDraft,
  readOnly,
}: FieldEditorProps<'description'>) {
  const { update, error, setError, notice, setNotice } = useFieldSave(card);
  const [fieldError, setFieldError] = useState<string>();
  const editing = !!draft && !readOnly;

  const start = () => {
    setNotice(undefined);
    setError(undefined);
    setFieldError(undefined);
    onDraft({ base: card.description, value: card.description ?? '' });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || update.isPending) return;
    const invalid = validateCardDescription(draft.value);
    setFieldError(invalid);
    setError(undefined);
    if (invalid) return;
    const description = normalizeCardDescription(draft.value);
    if (description === card.description) {
      onDraft(undefined);
      return;
    }
    try {
      await update.mutateAsync({ description });
      onDraft(undefined);
      setNotice('Description saved.');
    } catch (failure) {
      const result = toFormErrors(failure, { description: 'Description' });
      setFieldError(result.fieldErrors.description);
      setError(result.formError);
    }
  };

  return (
    <CardDetailSection
      icon={<TextIcon />}
      title="Description"
      action={
        !readOnly &&
        !editing && (
          <button type="button" className={sectionActionClass} onClick={start}>
            <PencilIcon aria-hidden="true" className="size-4" />
            Edit
            <span className="sr-only"> description</span>
          </button>
        )
      }
    >
      {editing ? (
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          className="space-y-3"
        >
          {draft.base !== card.description && (
            <RemoteChange
              what="description"
              onLoad={() =>
                onDraft({
                  base: card.description,
                  value: card.description ?? '',
                })
              }
            />
          )}
          <TextAreaField
            label="Description"
            name="description"
            rows={6}
            autoFocus
            value={draft.value}
            hint={`Optional. Up to ${CARD_DESCRIPTION_MAX_LENGTH} characters.`}
            error={fieldError}
            onChange={(event) =>
              onDraft({ ...draft, value: event.currentTarget.value })
            }
          />
          {error && <Alert variant="error">{error}</Alert>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={update.isPending}
              onClick={() => onDraft(undefined)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          {draft && isFieldDirty({ description: draft }, 'description') && (
            <StrandedDraft
              what="description"
              value={draft.value}
              onDiscard={() => onDraft(undefined)}
            />
          )}
          {card.description ? (
            <p className="text-sm leading-6 break-words whitespace-pre-wrap text-ink">
              {card.description}
            </p>
          ) : (
            <p className="text-sm text-muted">
              {readOnly ? 'No description.' : 'No description yet.'}
            </p>
          )}
          {notice && <Alert variant="success">{notice}</Alert>}
        </div>
      )}
    </CardDetailSection>
  );
}
