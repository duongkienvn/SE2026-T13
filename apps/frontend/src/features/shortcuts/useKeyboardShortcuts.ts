import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { boardViewKeys, chordTimeoutMs, navigationKeys } from './registry';

const editable =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]';
const overlay =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-shortcut-overlay], [aria-haspopup][aria-expanded="true"], details[open]:not([data-shortcut-card-overflow])';

function visible(element: HTMLElement) {
  if (
    element.closest(
      '[hidden], [inert], [aria-hidden="true"], details:not([open])',
    )
  )
    return false;
  const style = getComputedStyle(element);
  return (
    style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    element.getClientRects().length > 0
  );
}

/** Search and Escape remain owned by their existing overlay handlers. */
export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();
  const chord = useRef(0);
  useEffect(() => {
    chord.current = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.closest(editable) ||
        document.querySelector(overlay)
      ) {
        chord.current = 0;
        return;
      }
      const key = event.key.toLowerCase();
      if (event.shiftKey && event.key !== '?') {
        chord.current = 0;
        return;
      }
      if (event.key === '?') {
        chord.current = 0;
        event.preventDefault();
        void navigate('/settings/keyboard-shortcuts');
        return;
      }
      if (chord.current && Date.now() - chord.current <= chordTimeoutMs) {
        chord.current = 0;
        if (navigationKeys[key]) {
          event.preventDefault();
          void navigate(navigationKeys[key]);
          return;
        }
      } else chord.current = 0;
      if (key === 'g') {
        chord.current = Date.now();
        return;
      }

      const board = document.querySelector<HTMLElement>(
        '[data-shortcut-board]',
      );
      const boardId = board?.dataset.shortcutBoard;
      const match = location.pathname.match(
        /^\/boards\/([^/]+)(?:\/(calendar|table))?\/?$/,
      );
      if (
        !board ||
        !boardId ||
        !match ||
        match[1] !== encodeURIComponent(boardId)
      )
        return;
      if (Object.hasOwn(boardViewKeys, key)) {
        event.preventDefault();
        void navigate(
          `/boards/${encodeURIComponent(boardId)}${boardViewKeys[key]}${location.search}`,
        );
        return;
      }
      const cards = [
        ...board.querySelectorAll<HTMLElement>('[data-shortcut-card]'),
      ].filter(visible);
      if (key === 'j' || key === 'k') {
        if (!cards.length) return;
        const current = cards.indexOf(document.activeElement as HTMLElement);
        const next =
          current < 0
            ? key === 'j'
              ? 0
              : cards.length - 1
            : Math.max(
                0,
                Math.min(cards.length - 1, current + (key === 'j' ? 1 : -1)),
              );
        event.preventDefault();
        cards[next].focus();
      } else if (
        event.key === 'Enter' &&
        document.activeElement instanceof HTMLElement &&
        cards.includes(document.activeElement)
      ) {
        const cardId = document.activeElement.dataset.shortcutOpenCard;
        if (!cardId) return; // Native buttons already open Kanban and Table cards.
        event.preventDefault();
        void navigate(
          `/boards/${encodeURIComponent(boardId)}/cards/${encodeURIComponent(cardId)}${location.search}`,
          {
            state: {
              cardReturnTo: `${location.pathname}${location.search}${location.hash}`,
            },
          },
        );
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [location.hash, location.pathname, location.search, navigate]);
}
