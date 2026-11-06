import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const modalStack: { panel: HTMLElement | null; wasInert: boolean }[] = [];
let savedOverflow = '';
let rootWasInert = false;

function syncModalPanels() {
  modalStack.forEach((entry, index) => {
    if (!entry.panel) return;
    if (index < modalStack.length - 1 || entry.wasInert)
      entry.panel.setAttribute('inert', '');
    else entry.panel.removeAttribute('inert');
  });
}

/**
 * Modal behavior for a panel rendered outside `#root`: traps Tab focus,
 * closes on Escape, hides the page from assistive tech, locks body scroll
 * and restores focus to the opener when it closes.
 */
export function useModalFocus(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  dismissible = true,
) {
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  // Keep the latest props for the keydown listener, updated after commit.
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    if (!open) return;
    const entry = {
      panel: panelRef.current,
      wasInert: panelRef.current?.hasAttribute('inert') ?? false,
    };
    const opener = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root');
    if (modalStack.length === 0) {
      rootWasInert = root?.hasAttribute('inert') ?? false;
      savedOverflow = document.body.style.overflow;
      root?.setAttribute('inert', '');
      document.body.style.overflow = 'hidden';
    }
    modalStack.push(entry);
    syncModalPanels();

    const panel = panelRef.current;
    const first =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        modalStack.at(-1) !== entry ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229
      )
        return;
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
      const wasTop = modalStack.at(-1) === entry;
      const index = modalStack.indexOf(entry);
      if (index !== -1) modalStack.splice(index, 1);
      if (entry.panel && !entry.wasInert) entry.panel.removeAttribute('inert');
      syncModalPanels();
      if (modalStack.length === 0) {
        if (!rootWasInert) root?.removeAttribute('inert');
        document.body.style.overflow = savedOverflow;
      }
      if (wasTop && opener?.isConnected) opener.focus();
    };
  }, [open, panelRef]);
}
