import { Link, Outlet, useLocation, useMatches } from 'react-router';
import { ChevronRightIcon } from '../../components/icons';
import { AccountLinks } from '../../features/auth/components/AccountLinks';
import { UserMenu } from '../../features/auth/components/UserMenu';
import { useBoardMembers } from '../../features/board-members/hooks';
import { useVerifiedBoard } from '../../features/boards/useVerifiedBoard';
import { isBoardUnavailable } from '../../features/boards/pages/BoardDetailPage';
import { AppShell } from './AppShell';
import { findActiveNavItemId, navGroups } from './navigation';

/** Application shell for signed-in routes, with App Shell V2 navigation, board context and the user menu. */
export function AuthenticatedLayout() {
  const { pathname } = useLocation();
  // The deepest match carries every route param, e.g. `boardId` on board pages.
  const boardId = useMatches().at(-1)?.params.boardId;
  // Shares the board page's cached query; nothing is shown until it loads.
  const { board, verified } = useVerifiedBoard(boardId);
  // Observe the page's existing member query without issuing another request.
  // A member-list refusal can arrive before the board's next refresh.
  const members = useBoardMembers(boardId ?? '', { enabled: false });
  const unavailable =
    (board.isError && isBoardUnavailable(board.error)) ||
    (members.isError && isBoardUnavailable(members.error));
  // Hide a cached name once access to the board is lost.
  const boardName = unavailable || !verified ? undefined : board.data?.name;

  return (
    <AppShell
      navGroups={navGroups}
      activeNavItemId={findActiveNavItemId(navGroups, pathname)}
      headerContext={
        boardId &&
        boardName && (
          <nav aria-label="Breadcrumb" className="min-w-0">
            <ol className="flex min-w-0 items-center gap-2">
              <li className="hidden shrink-0 sm:block">
                <Link
                  to="/boards"
                  className="text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                >
                  Boards
                </Link>
              </li>
              <li aria-hidden="true" className="hidden text-muted sm:block">
                <ChevronRightIcon className="size-4" />
              </li>
              <li className="min-w-0">
                <Link
                  to={`/boards/${boardId}`}
                  className="block truncate hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {boardName}
                </Link>
              </li>
            </ol>
          </nav>
        )
      }
      headerActions={<UserMenu />}
      drawerFooter={<AccountLinks />}
    >
      <Outlet />
    </AppShell>
  );
}
