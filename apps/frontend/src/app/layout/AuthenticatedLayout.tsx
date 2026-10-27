import { Link, Outlet, useLocation, useMatches } from 'react-router';
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
