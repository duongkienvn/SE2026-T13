import type { ReactNode } from 'react';
import { BellIcon, SearchIcon } from '../../components/icons';
import { SoonBadge } from './SoonBadge';

interface AppHeaderProps {
  /** Page context on the left, e.g. the current board breadcrumb. */
  context?: ReactNode;
  /** Right-aligned actions, e.g. the signed-in user's menu. */
  actions?: ReactNode;
}

export function AppHeader({ context, actions }: AppHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-4 md:h-15 md:gap-5 md:px-6">
      {context && (
        <div className="flex min-w-0 items-center text-sm font-medium text-ink">
          {context}
        </div>
      )}
      <SearchSlot />
      <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-3">
        <NotificationsSlot />
        {actions}
      </div>
    </header>
  );
}

/**
 * Approved global Search position. Static until the search palette ships:
 * not an input, no results, no keyboard shortcut.
 */
function SearchSlot() {
  return (
    <div
      title="Search — coming soon"
      className="flex h-10 w-full max-w-sm min-w-0 items-center gap-2.5 rounded-lg border border-line bg-app px-3 text-sm text-muted/70"
    >
      <SearchIcon className="size-4.5 shrink-0" />
      <span aria-hidden="true" className="min-w-0 flex-1 truncate">
        Search
      </span>
      <SoonBadge />
      <span className="sr-only">Search, coming soon</span>
    </div>
  );
}

/** Approved Notifications bell position. Static until notifications ship: no badge or popover. */
function NotificationsSlot() {
  return (
    <span
      title="Notifications — coming soon"
      className="grid size-10 shrink-0 place-items-center rounded-lg text-muted/60"
    >
      <BellIcon className="size-5" />
      <span className="sr-only">Notifications, coming soon</span>
    </span>
  );
}
