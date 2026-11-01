import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../hooks/useModalFocus';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Prevents closing (Escape, backdrop) while a request is running. */
  dismissible?: boolean;
  /** `wide` fits a two-column layout; `detail` is the Card Detail V2 width. */
  size?: 'default' | 'wide' | 'detail';
  fullscreenOnMobile?: boolean;
  /** Controls beside the title, e.g. edit and close buttons. */
  headerActions?: ReactNode;
}

/**
 * Modal dialog: traps focus, closes on Escape or backdrop click, restores
 * focus to the opener and hides the page from assistive tech while open.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  dismissible = true,
  size = 'default',
  fullscreenOnMobile = false,
  headerActions,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useModalFocus(open, panelRef, onClose, dismissible);

  if (!open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${fullscreenOnMobile ? 'sm:p-4' : 'p-4'}`}
    >
      <div
        aria-hidden="true"
        data-dialog-backdrop
        className="absolute inset-0 bg-overlay/40"
        onClick={() => dismissible && onClose()}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`relative w-full ${fullscreenOnMobile ? 'h-dvh max-h-dvh rounded-none sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl' : 'max-h-[calc(100dvh-2rem)] rounded-2xl'} ${
          size === 'detail'
            ? 'max-w-5xl'
            : size === 'wide'
              ? 'max-w-4xl'
              : 'max-w-lg'
        } overflow-y-auto bg-surface p-5 shadow-frame focus:outline-none sm:p-6`}
      >
        <div className="flex items-start gap-3">
          <h2
            id={titleId}
            className={`min-w-0 flex-1 font-semibold break-words text-ink ${
              size === 'default' ? 'text-lg' : 'text-xl sm:text-2xl'
            }`}
          >
            {title}
          </h2>
          {headerActions && (
            <div className="-mt-1 -mr-2 flex shrink-0 items-center gap-1">
              {headerActions}
            </div>
          )}
        </div>
        {description && (
          <p id={descriptionId} className="mt-1 text-sm text-muted">
            {description}
          </p>
        )}
        <div className="mt-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
