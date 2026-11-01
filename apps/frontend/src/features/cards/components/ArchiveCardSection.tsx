import { useState } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { ArchiveIcon } from '../../../components/icons';
import { railActionClass } from './detail/CardDetailSection';

interface ArchiveCardSectionProps {
  pending: boolean;
  error?: string;
  /** Unsent edits exist; archiving makes the card read-only. */
  hasUnsavedChanges?: boolean;
  onArchive: () => void;
  onCancel: () => void;
}

/** Asks for confirmation in place: a second dialog would trap Escape twice. */
export function ArchiveCardSection({
  pending,
  error,
  hasUnsavedChanges = false,
  onArchive,
  onCancel,
}: ArchiveCardSectionProps) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        className={railActionClass}
        onClick={() => setConfirming(true)}
      >
        <ArchiveIcon aria-hidden="true" className="size-4 text-muted" />
        Archive card
      </button>
    );
  }
  return (
    <div
      role="group"
      aria-label="Archive card"
      className="space-y-3 rounded-lg border border-danger/30 bg-danger/5 p-3"
    >
      <p className="text-sm text-ink">
        Archive this card? It disappears from the board for every member. You
        can restore it from Archived cards in the board actions menu.
        {hasUnsavedChanges && ' Your unsaved edits will be discarded.'}
      </p>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="danger"
          size="sm"
          onClick={onArchive}
          disabled={pending}
        >
          {pending ? 'Archiving…' : 'Archive card'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
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
