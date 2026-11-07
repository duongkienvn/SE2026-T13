import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../hooks/useModalFocus';

interface DialogProps {
  id?: string;
  anchor?: DOMRect;
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
  /** Optional Card Detail context below its heading, e.g. assigned labels. */
  headerContent?: ReactNode;
  /** Decorative tile before the title, e.g. a destructive action's icon. */
  icon?: ReactNode;
}

/**
 * Modal dialog: traps focus, closes on Escape or backdrop click, restores
 * focus to the opener and hides the page from assistive tech while open.
 */
export function Dialog({
  id,
  anchor,
  open,
  onClose,
  title,
  description,
  children,
  dismissible = true,
  size = 'default',
  fullscreenOnMobile = false,
  headerActions,
  headerContent,
  icon,
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
        className={`absolute inset-0 bg-overlay/40 ${size === 'detail' ? 'backdrop-blur-[2px]' : ''}`}
        onClick={() => dismissible && onClose()}
      />
      <div
        ref={panelRef}
        id={id}
        style={
          anchor
            ? {
                position: 'fixed',
                width: `min(28rem, calc(100vw - 2rem))`,
                left: Math.max(
                  16,
                  Math.min(
                    anchor.left,
                    window.innerWidth -
                      Math.min(448, window.innerWidth - 32) -
                      16,
                  ),
                ),
                top: Math.max(
                  16,
                  Math.min(anchor.bottom + 8, window.innerHeight - 250),
                ),
                maxHeight: `calc(100dvh - ${Math.max(16, Math.min(anchor.bottom + 8, window.innerHeight - 250)) + 16}px)`,
              }
            : undefined
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`relative w-full ${fullscreenOnMobile ? 'h-dvh max-h-dvh rounded-none sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl' : 'max-h-[calc(100dvh-2rem)] rounded-2xl'} ${
          size === 'detail'
            ? 'card-detail-dialog flex max-w-6xl flex-col overflow-hidden'
            : size === 'wide'
              ? 'max-w-4xl'
              : 'max-w-lg'
        } ${size === 'detail' ? '' : 'overflow-y-auto p-5 sm:p-6'} bg-surface shadow-frame focus:outline-none`}
      >
        <div
          className={
            size === 'detail'
              ? 'shrink-0 border-b border-line px-4 py-4 sm:px-7'
              : ''
          }
        >
          <div className="flex items-start gap-3">
            {icon}
            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                className={`min-w-0 font-semibold break-words text-ink ${
                  size === 'default' ? 'text-lg' : 'text-xl sm:text-2xl'
                }`}
              >
                {title}
              </h2>
              {size === 'detail' && description && (
                <p
                  id={descriptionId}
                  className="mt-1 text-sm text-muted [overflow-wrap:anywhere]"
                >
                  {description}
                </p>
              )}
              {headerContent && <div className="mt-2">{headerContent}</div>}
            </div>
            {headerActions && (
              <div className="-mt-1 -mr-2 flex shrink-0 items-center gap-1">
                {headerActions}
              </div>
            )}
          </div>
          {size !== 'detail' && description && (
            <p id={descriptionId} className="mt-1 text-sm text-muted">
              {description}
            </p>
          )}
        </div>
        <div
          className={
            size === 'detail'
              ? 'card-detail-body min-h-0 overflow-y-auto px-4 py-3 sm:px-7 sm:pb-5'
              : 'mt-5'
          }
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
