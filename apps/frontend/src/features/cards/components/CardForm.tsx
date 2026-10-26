import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useBeforeUnload, useBlocker } from 'react-router';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { TextAreaField } from '../../../components/TextAreaField';
import { TextField } from '../../../components/TextField';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { toFormErrors } from '../../../lib/form-errors';
import type { Card, UpdateCardRequest } from '../types';
import {
  CARD_DESCRIPTION_MAX_LENGTH,
  dueDateFromInput,
  dueDateToInput,
  normalizeCardDescription,
  validateCardDescription,
  validateCardTitle,
} from '../validation';
const FIELD_LABELS = {
  title: 'Title',
  description: 'Description',
  dueDate: 'Due date',
};
type Field = keyof typeof FIELD_LABELS;
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

export function CardForm({
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
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !readOnly &&
      changed &&
      currentLocation.pathname !== nextLocation.pathname,
  );
  const discardPrompt = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (blocker.state === 'blocked') discardPrompt.current?.focus();
  }, [blocker.state]);
  useBeforeUnload((event) => {
    if (!readOnly && changed) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

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
        {blocker.state === 'blocked' && (
          <div
            ref={discardPrompt}
            tabIndex={-1}
            aria-label="Unsaved card changes"
            className="focus:outline-none"
          >
            <Alert variant="error">
              <p>You have unsaved card changes. Discard them and leave?</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button variant="secondary" onClick={() => blocker.reset()}>
                  Keep editing
                </Button>
                <Button variant="danger" onClick={() => blocker.proceed()}>
                  Discard changes
                </Button>
              </div>
            </Alert>
          </div>
        )}
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
