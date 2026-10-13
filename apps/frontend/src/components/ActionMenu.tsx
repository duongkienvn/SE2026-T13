import { useEffect, useId, useRef, useState } from 'react';
import { MoreVerticalIcon } from './icons';

export interface ActionMenuItem {
  label: string;
  onSelect: () => void;
  tone?: 'default' | 'danger';
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
          className="absolute top-full right-0 z-20 mt-1 w-44 rounded-xl border border-line bg-surface p-1.5 shadow-frame"
        >
          {items.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                onClick={() => {
                  // Items unmount on close; keep focus on the trigger so a
                  // dialog opened by the action can return focus there.
                  buttonRef.current?.focus();
                  setOpen(false);
                  item.onSelect();
                }}
                className={`block w-full rounded-lg px-3 py-2 text-left text-[15px] hover:bg-app focus-visible:outline-2 focus-visible:outline-primary ${
                  item.tone === 'danger' ? 'text-danger' : 'text-ink'
                }`}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
