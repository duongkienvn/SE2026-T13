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
  /** `wide` fits a two-column layout such as the card detail. */
  size?: 'default' | 'wide';
  fullscreenOnMobile?: boolean;
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
          size === 'wide' ? 'max-w-4xl' : 'max-w-lg'
        } overflow-y-auto bg-surface p-5 shadow-frame focus:outline-none sm:p-6`}
      >
        <h2
          id={titleId}
          className={`font-semibold break-words text-ink ${
            size === 'wide' ? 'text-xl sm:text-2xl' : 'text-lg'
          }`}
        >
          {title}
        </h2>
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
