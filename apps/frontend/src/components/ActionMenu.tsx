import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { MoreVerticalIcon } from './icons';

export interface ActionMenuItem {
  label: string;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  /** When set, the item is shown but unavailable, with this reason under it. */
  disabledReason?: string;
}

interface ActionMenuProps {
  /** Accessible name of the trigger, e.g. "Actions for Design Team". */
  label: string;
  items: ActionMenuItem[];
  className?: string;
}

/** "⋮" disclosure with a short list of actions. Closes on Escape and outside click. */
export function ActionMenu({ label, items, className = '' }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);
  const panelId = useId();

  // Open upwards when the panel would run past the bottom of the scroll area
  // (e.g. on the last table row), so it never makes the page scroll.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const button = buttonRef.current;
    if (!open || !panel || !button) return;
    const area = button.closest('main')?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight,
    };
    const trigger = button.getBoundingClientRect();
    // Panel height plus its 4px offset from the trigger (mt-1 / mb-1).
    const space = panel.getBoundingClientRect().height + 4;
    setAbove(
      trigger.bottom + space > area.bottom && trigger.top - space >= area.top,
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setAbove(false);
          setOpen((value) => !value);
        }}
        className="grid size-8 place-items-center rounded-lg text-lg text-muted hover:bg-app hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
      >
        <MoreVerticalIcon />
      </button>
      {open && (
        <ul
          ref={panelRef}
          id={panelId}
          className={`absolute right-0 z-20 w-60 rounded-xl border border-line bg-surface p-1.5 shadow-frame ${
            above ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {items.map((item) => {
            const disabled = !!item.disabledReason;
            const reasonId = `${panelId}-${item.label.replace(/\W+/g, '-')}`;
            return (
              <li key={item.label}>
                <button
                  type="button"
                  aria-disabled={disabled || undefined}
                  aria-describedby={disabled ? reasonId : undefined}
                  onClick={() => {
                    if (disabled) return;
                    // Items unmount on close; keep focus on the trigger so a
                    // dialog opened by the action can return focus there.
                    buttonRef.current?.focus();
                    setOpen(false);
                    item.onSelect();
                  }}
                  className={`block w-full rounded-lg px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-primary ${
                    disabled
                      ? 'cursor-not-allowed text-muted'
                      : item.tone === 'danger'
                        ? 'text-danger hover:bg-app'
                        : 'text-ink hover:bg-app'
                  }`}
                >
                  {item.label}
                  {disabled && (
                    <span id={reasonId} className="mt-0.5 block text-[13px]">
                      {item.disabledReason}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
