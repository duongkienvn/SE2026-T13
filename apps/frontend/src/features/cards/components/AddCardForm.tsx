import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Button } from '../../../components/Button';
import { toFormErrors } from '../../../lib/form-errors';
import { useCreateCard } from '../hooks';
import { validateCardTitle } from '../validation';

interface AddCardFormProps {
  boardId: string;
  columnId: string;
  columnName: string;
  onClose: () => void;
}

/**
 * Title-only composer at the bottom of a column. Enter adds the card and keeps
 * the composer open for the next one; Escape closes it.
 */
export function AddCardForm({
  boardId,
  columnId,
  columnName,
  onClose,
}: AddCardFormProps) {
  const create = useCreateCard(boardId);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string>();
  const errorId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  // At the bottom of a long column the composer starts out of view.
  useEffect(() => {
    formRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (create.isPending) return;
    const invalid = validateCardTitle(title);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(undefined);
    try {
      await create.mutateAsync({ columnId, title: title.trim() });
      setTitle('');
    } catch (failure) {
      const result = toFormErrors(failure, { title: 'Title' });
      setError(result.fieldErrors.title ?? result.formError);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape' && !create.isPending) {
      // Keep Escape from also closing anything around the column.
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-2">
      <textarea
        aria-label={`Title of the new card in ${columnName}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        // The user just opened the composer, so moving focus here is expected.
        autoFocus
        rows={2}
        value={title}
        placeholder="Enter a title…"
        readOnly={create.isPending}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={onKeyDown}
        className={`block w-full resize-none rounded-lg border bg-surface px-3 py-2.5 text-sm text-ink shadow-card placeholder:text-muted/80 focus:ring-3 focus:ring-primary/15 focus:outline-none ${
          error ? 'border-danger' : 'border-line focus:border-primary'
        }`}
      />
      {error && (
        <p id={errorId} role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Adding…' : 'Add card'}
        </Button>
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={create.isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
