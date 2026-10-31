import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BrandLogo } from '../../components/Brand';
import { BellIcon, MenuIcon, SearchIcon } from '../../components/icons';
import { SoonBadge } from './SoonBadge';

interface AppHeaderProps {
  /** Page context on the left, e.g. the current board breadcrumb. */
  context?: ReactNode;
  /** Right-aligned actions, e.g. the signed-in user's menu. */
  actions?: ReactNode;
  /** Opens the navigation drawer below the desktop breakpoint. */
  navigation?: {
    controls: string;
    expanded: boolean;
    onOpen: () => void;
  };
}

export function AppHeader({ context, actions, navigation }: AppHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:gap-4 sm:px-4 md:h-15 md:px-6 lg:gap-5">
      {navigation && (
        <button
          type="button"
          aria-label="Open navigation"
          aria-haspopup="dialog"
          aria-expanded={navigation.expanded}
          aria-controls={navigation.controls}
          onClick={navigation.onOpen}
          className="grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-app hover:text-ink focus-visible:outline-2 focus-visible:outline-primary lg:hidden"
        >
          <MenuIcon className="size-5" />
        </button>
      )}
      {/* Phones have no rail, so the brand moves into the header. */}
      <Link
        to="/"
        aria-label="Kanvexa landing page"
        title="Kanvexa landing page"
        className="flex min-h-11 shrink-0 items-center rounded-lg transition-colors hover:bg-app active:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:hidden"
      >
        <BrandLogo decorative className="size-8" />
      </Link>
      {context && (
        <div className="flex min-w-0 flex-1 items-center text-sm font-medium text-ink">
          {context}
        </div>
      )}
      <SearchSlot compact={!!context} />
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
function SearchSlot({ compact = false }: { compact?: boolean }) {
  return (
    <div
      title="Search — coming soon"
      className={`grid size-10 shrink-0 place-items-center text-muted/60 ${compact ? 'xl:flex xl:h-10 xl:w-full xl:max-w-48 xl:min-w-0 xl:shrink xl:items-center xl:gap-2.5 xl:rounded-lg xl:border xl:border-line xl:bg-app xl:px-3 xl:text-sm xl:text-muted/70' : 'sm:flex sm:h-10 sm:w-full sm:max-w-sm sm:min-w-0 sm:shrink sm:items-center sm:gap-2.5 sm:rounded-lg sm:border sm:border-line sm:bg-app sm:px-3 sm:text-sm sm:text-muted/70'}`}
    >
      <SearchIcon className="size-5 shrink-0 sm:size-4.5" />
      <span
        aria-hidden="true"
        className={`hidden min-w-0 flex-1 truncate ${compact ? 'xl:block' : 'sm:block'}`}
      >
        Search
      </span>
      <span className={compact ? 'hidden xl:contents' : 'hidden sm:contents'}>
        <SoonBadge />
      </span>
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
