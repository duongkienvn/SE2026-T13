import { Outlet, useLocation, useNavigate } from 'react-router';
import { UserMenu } from '../../features/auth/components/UserMenu';
import { AppShell } from './AppShell';
import { primaryNavItems, secondaryNavItems, type NavItem } from './navigation';

function isActive(item: NavItem, pathname: string): boolean {
  return (
    !!item.path &&
    (pathname === item.path || pathname.startsWith(`${item.path}/`))
  );
}

/** Application shell for signed-in routes, with routable navigation and the user menu. */
export function AuthenticatedLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const withNavigation = (items: NavItem[]) =>
    items.map((item) =>
      item.path ? { ...item, onSelect: () => navigate(item.path!) } : item,
    );
  const activeItem = [...primaryNavItems, ...secondaryNavItems].find((item) =>
    isActive(item, pathname),
  );

  return (
    <AppShell
      primaryNavItems={withNavigation(primaryNavItems)}
      secondaryNavItems={withNavigation(secondaryNavItems)}
      activeNavItemId={activeItem?.id}
      headerActions={<UserMenu />}
    >
      <Outlet />
    </AppShell>
  );
}
