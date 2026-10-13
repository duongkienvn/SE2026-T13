import type { ReactNode } from 'react';
import { AppHeader } from './AppHeader';
import { primaryNavItems, secondaryNavItems } from './navigation';
import { Sidebar } from './Sidebar';

interface AppShellProps {
  children: ReactNode;
  activeNavItemId?: string;
  headerContext?: ReactNode;
  headerActions?: ReactNode;
}

/** Authenticated application frame: lavender outer frame, side rail, top header and scrollable content. */
export function AppShell({
  children,
  activeNavItemId,
  headerContext,
  headerActions,
}: AppShellProps) {
  return (
    <div className="h-dvh bg-frame md:p-4">
      <div className="flex h-full overflow-hidden bg-app md:rounded-2xl md:shadow-frame">
        <Sidebar
          primaryItems={primaryNavItems}
          secondaryItems={secondaryNavItems}
          activeItemId={activeNavItemId}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader context={headerContext} actions={headerActions} />
          <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
    </div>
  );
}
