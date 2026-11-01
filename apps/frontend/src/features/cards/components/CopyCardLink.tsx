import { useState } from 'react';
import { Alert } from '../../../components/Alert';
import { TextField } from '../../../components/TextField';
import { LinkIcon } from '../../../components/icons';
import { railActionClass } from './detail/CardDetailSection';

export function CopyCardLink({
  boardId,
  cardId,
}: {
  readonly boardId: string;
  readonly cardId: string;
}) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'fallback'>('idle');
  const url = `${window.location.origin}/boards/${boardId}/cards/${cardId}`;

  const copy = async () => {
    setStatus('idle');
    try {
      if (!window.isSecureContext || !navigator.clipboard?.writeText) {
        setStatus('fallback');
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus('copied');
    } catch {
      // Clipboard permissions vary by browser; manual copy is always available.
      setStatus('fallback');
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        className={railActionClass}
        onClick={() => void copy()}
      >
        <LinkIcon aria-hidden="true" className="size-4 text-muted" />
        Copy link
      </button>
      {status === 'copied' && <Alert variant="success">Link copied.</Alert>}
      {status === 'fallback' && (
        <TextField
          label="Card link"
          value={url}
          readOnly
          hint="Clipboard unavailable. Select this link and copy it. Only board members can open it."
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </div>
  );
}
