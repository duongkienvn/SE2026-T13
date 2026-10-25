import { Alert } from './Alert';
import { Button } from './Button';
import { Dialog } from './Dialog';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  confirmVariant?: 'primary' | 'danger';
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation for destructive actions such as archive or remove. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel,
  pending,
  confirmVariant = 'danger',
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      dismissible={!pending}
    >
      {error && (
        <div className="mb-5">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          onClick={onCancel}
          disabled={pending}
          data-autofocus
        >
          Cancel
        </Button>
        <Button variant={confirmVariant} onClick={onConfirm} disabled={pending}>
          {pending ? pendingLabel : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
