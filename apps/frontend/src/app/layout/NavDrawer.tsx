import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BrandLogo } from '../../components/Brand';
import { CloseIcon } from '../../components/icons';
import { useModalFocus } from '../../hooks/useModalFocus';
import type { NavGroup } from './navigation';
import { SidebarNavContent } from './Sidebar';

interface NavDrawerProps {
  id: string;
  open: boolean;
  onClose: () => void;
  groups: NavGroup[];
  activeItemId?: string;
  /** Account actions pinned to the bottom of the drawer. */
  footer?: ReactNode;
}

/**
 * Below the desktop breakpoint, the full App Shell navigation opens as a
 * modal drawer: focus is trapped and restored, Escape or the backdrop
 * closes it, and the page behind does not scroll.
 */
export function NavDrawer({
  id,
  open,
  onClose,
  groups,
  activeItemId,
  footer,
}: NavDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, panelRef, onClose);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-40 lg:hidden">
      <div
        aria-hidden="true"
        data-drawer-backdrop
        className="absolute inset-0 bg-overlay/40"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        tabIndex={-1}
        className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-frame focus:outline-none motion-safe:animate-[drawer-in_180ms_ease-out]"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 pr-2 pl-4">
          <BrandLogo className="size-9" />
          <span className="text-lg font-semibold tracking-tight text-ink">
            Kanvexa
          </span>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            className="ml-auto grid size-11 place-items-center rounded-lg text-muted hover:bg-app hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
          >
            <CloseIcon className="size-5" />
          </button>
        </div>
        <nav
          aria-label="Primary"
          className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
        >
          <SidebarNavContent
            groups={groups}
            activeItemId={activeItemId}
            expanded
            roomy
          />
        </nav>
        {footer && (
          <div className="shrink-0 border-t border-line px-3 py-2">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
