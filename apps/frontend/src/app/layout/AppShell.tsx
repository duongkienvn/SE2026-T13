import { useId, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { AppHeader } from './AppHeader';
import { navGroups as defaultNavGroups, type NavGroup } from './navigation';
import { NavDrawer } from './NavDrawer';
import { Sidebar, type WorkspaceShellSlots } from './Sidebar';

interface AppShellProps {
  children: ReactNode;
  navGroups?: NavGroup[];
  activeNavItemId?: string;
  headerContext?: ReactNode;
  headerActions?: ReactNode;
  sidebarFooter?: (expanded: boolean) => ReactNode;
  /** Account actions at the bottom of the mobile navigation drawer. */
  drawerFooter?: ReactNode;
  workspaceSlots?: WorkspaceShellSlots;
}

/** Authenticated application frame: lavender outer frame, side rail, top header and scrollable content. */
export function AppShell({
  children,
  navGroups = defaultNavGroups,
  activeNavItemId,
  headerContext,
  headerActions,
  sidebarFooter,
  drawerFooter,
  workspaceSlots,
}: AppShellProps) {
  const desktop = useMediaQuery('(min-width: 1024px)', true);
  const { key: locationKey } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(locationKey);
  // Any navigation (link, back/forward) closes the drawer, and it only
  // exists below the desktop breakpoint.
  if (drawerOpen && (openedAt !== locationKey || desktop)) {
    setDrawerOpen(false);
  }
  const drawerId = useId();
  const showDrawer = drawerOpen && !desktop;

  return (
    <div className="h-dvh bg-frame md:p-3">
      <a
        href="#main-content"
        className="sr-only z-10 rounded-lg bg-surface px-4 py-2 font-medium text-primary shadow-card focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <div className="flex h-full overflow-hidden bg-app md:rounded-2xl md:shadow-frame">
        <Sidebar
          groups={navGroups}
          activeItemId={activeNavItemId}
          footer={sidebarFooter}
          workspaceSlots={workspaceSlots}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader
            context={headerContext}
            actions={headerActions}
            navigation={{
              controls: drawerId,
              expanded: showDrawer,
              onOpen: () => {
                setOpenedAt(locationKey);
                setDrawerOpen(true);
              },
            }}
          />
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
      <NavDrawer
        id={drawerId}
        open={showDrawer}
        onClose={() => setDrawerOpen(false)}
        groups={navGroups}
        activeItemId={activeNavItemId}
        footer={drawerFooter}
        workspaceSlots={workspaceSlots}
      />
    </div>
  );
}
