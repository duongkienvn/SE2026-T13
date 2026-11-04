import { useEffect, useState } from 'react';
import { SearchIcon } from '../../components/icons';
import { SearchPalette } from './SearchPalette';

export function SearchTrigger({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const shortcut =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform)
      ? '⌘ K'
      : 'Ctrl K';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.shiftKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'k'
      )
        return;
      if (open || document.querySelector('[role="dialog"][aria-modal="true"]'))
        return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="Search"
        aria-haspopup="dialog"
        onClick={(event) => {
          if (!document.querySelector('[role="dialog"][aria-modal="true"]')) {
            event.currentTarget.focus();
            setOpen(true);
          }
        }}
        className={`relative grid size-10 shrink-0 place-items-center rounded-lg text-muted after:absolute after:-inset-0.5 after:content-[''] hover:text-ink focus-visible:outline-2 focus-visible:outline-primary ${compact ? 'xl:flex xl:h-10 xl:w-full xl:max-w-48 xl:min-w-0 xl:shrink xl:items-center xl:gap-2.5 xl:border xl:border-line xl:bg-app xl:px-3 xl:text-sm' : 'sm:flex sm:h-10 sm:w-full sm:max-w-sm sm:min-w-0 sm:shrink sm:items-center sm:gap-2.5 sm:border sm:border-line sm:bg-app sm:px-3 sm:text-sm'}`}
      >
        <SearchIcon className="size-5 shrink-0 sm:size-4.5" />
        <span
          aria-hidden="true"
          className={`hidden min-w-0 flex-1 truncate text-left ${compact ? 'xl:block' : 'sm:block'}`}
        >
          Search
        </span>
        <kbd
          aria-hidden="true"
          className={`text-xs text-muted ${compact ? 'hidden xl:block' : 'hidden sm:block'}`}
        >
          {shortcut}
        </kbd>
      </button>
      {open && <SearchPalette onClose={() => setOpen(false)} />}
    </>
  );
}
