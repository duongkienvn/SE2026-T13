import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

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

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  // Keep the latest props for the keydown listener, updated after commit.
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const panel = panelRef.current;
    const first =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (dismissibleRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      root?.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${fullscreenOnMobile ? 'sm:p-4' : 'p-4'}`}
    >
      <div
        aria-hidden="true"
        data-dialog-backdrop
        className="absolute inset-0 bg-ink/40"
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
