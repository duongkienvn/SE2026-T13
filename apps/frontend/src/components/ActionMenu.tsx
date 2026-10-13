import { useEffect, useId, useRef, useState } from 'react';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

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
        onClick={() => setOpen((value) => !value)}
        className="grid size-9 place-items-center rounded-lg text-xl text-muted hover:bg-app hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
      >
        <MoreVerticalIcon />
      </button>
      {open && (
        <ul
          id={panelId}
          className="absolute top-full right-0 z-20 mt-1 w-60 rounded-xl border border-line bg-surface p-1.5 shadow-frame"
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
                  className={`block w-full rounded-lg px-3 py-2 text-left text-[15px] focus-visible:outline-2 focus-visible:outline-primary ${
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
