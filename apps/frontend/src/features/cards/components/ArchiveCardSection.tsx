import { useState } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
interface ArchiveCardSectionProps {
  pending: boolean;
  error?: string;
  onArchive: () => void;
  onCancel: () => void;
}

/** Asks for confirmation in place: a second dialog would trap Escape twice. */
export function ArchiveCardSection({
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
        Archive this card? It disappears from the board for every member. You
        can restore it from Archived cards in the board actions menu.
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
