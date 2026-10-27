import type { ReactNode } from 'react';
import { AppHeader } from './AppHeader';
import { navGroups as defaultNavGroups, type NavGroup } from './navigation';
import { Sidebar } from './Sidebar';

interface AppShellProps {
  children: ReactNode;
  navGroups?: NavGroup[];
  activeNavItemId?: string;
  headerContext?: ReactNode;
  headerActions?: ReactNode;
}

/** Authenticated application frame: lavender outer frame, side rail, top header and scrollable content. */
export function AppShell({
  children,
  navGroups = defaultNavGroups,
  activeNavItemId,
  headerContext,
  headerActions,
}: AppShellProps) {
  return (
    <div className="h-dvh bg-frame md:p-3">
      <a
        href="#main-content"
        className="sr-only z-10 rounded-lg bg-surface px-4 py-2 font-medium text-primary shadow-card focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <div className="flex h-full overflow-hidden bg-app md:rounded-2xl md:shadow-frame">
        <Sidebar groups={navGroups} activeItemId={activeNavItemId} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader context={headerContext} actions={headerActions} />
          {/* Contain absolute sr-only announcements in this scroller so their
              static positions below long forms cannot grow the document. */}
          <main
            id="main-content"
            tabIndex={-1}
            className="relative min-h-0 flex-1 overflow-auto focus:outline-none"
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
