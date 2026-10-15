import {
  Link,
  Outlet,
  useLocation,
  useMatches,
  useNavigate,
} from 'react-router';
import { UserMenu } from '../../features/auth/components/UserMenu';
import { useBoard } from '../../features/boards/hooks';
import { isBoardUnavailable } from '../../features/boards/pages/BoardDetailPage';
import { AppShell } from './AppShell';
import { primaryNavItems, secondaryNavItems, type NavItem } from './navigation';

function matchesPath(path: string, pathname: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** Application shell for signed-in routes, with routable navigation and the user menu. */
export function AuthenticatedLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The deepest match carries every route param, e.g. `boardId` on board pages.
  const boardId = useMatches().at(-1)?.params.boardId;
  // Shares the board page's cached query; nothing is shown until it loads.
  const board = useBoard(boardId ?? '', { enabled: !!boardId });
  // Hide a cached name once access to the board is lost.
  const boardName =
    board.isError && isBoardUnavailable(board.error)
      ? undefined
      : board.data?.name;

  const resolve = (item: NavItem): NavItem => {
    // Board-scoped items (e.g. members) only work inside a board.
    const path = item.boardPath
      ? boardId && item.boardPath(boardId)
      : item.path;
    return path
      ? { ...item, path, onSelect: () => navigate(path) }
      : { ...item, path: undefined };
  };
  const primary = primaryNavItems.map(resolve);
  const secondary = secondaryNavItems.map(resolve);

  // Most specific match wins: /boards/1/members highlights Members, not Boards.
  const activeItem = [...primary, ...secondary]
    .filter((item) => item.path && matchesPath(item.path, pathname))
    .sort((a, b) => b.path!.length - a.path!.length)[0];

  return (
    <AppShell
      primaryNavItems={primary}
      secondaryNavItems={secondary}
      activeNavItemId={activeItem?.id}
      headerContext={
        boardId &&
        boardName && (
          <Link
            to={`/boards/${boardId}`}
            className="truncate hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
          >
            {boardName}
          </Link>
        )
      }
      headerActions={<UserMenu />}
    >
      <Outlet />
    </AppShell>
  );
}
