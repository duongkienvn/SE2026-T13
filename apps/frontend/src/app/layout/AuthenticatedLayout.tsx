import { Link, Outlet, useLocation, useMatches } from 'react-router';
import { ChevronRightIcon } from '../../components/icons';
import { AccountLinks } from '../../features/auth/components/AccountLinks';
import { UserMenu } from '../../features/auth/components/UserMenu';
import { UserAvatar } from '../../features/auth/components/UserAvatar';
import { useAuth } from '../../features/auth/useAuth';
import { useBoardMembers } from '../../features/board-members/hooks';
import { useVerifiedBoard } from '../../features/boards/useVerifiedBoard';
import { isBoardUnavailable } from '../../features/boards/pages/BoardDetailPage';
import { AppShell } from './AppShell';
import { useAuthSession } from '../../features/auth/auth-session-context';
import {
  WorkspaceNavigation,
  WorkspaceSwitcher,
} from '../../features/workspaces/components/WorkspaceNavigation';
import { findActiveNavItemId, navGroups } from './navigation';
import { useWorkspaceDirectory } from '../../features/workspaces/hooks';
import { workspacePath } from '../../features/workspaces/navigation';

/** Application shell for signed-in routes, with App Shell V2 navigation, board context and the user menu. */
export function AuthenticatedLayout() {
  const { generation } = useAuthSession();
  return <SessionLayout key={generation} />;
}

function SessionLayout() {
  const { user } = useAuth();
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
  const directory = useWorkspaceDirectory();
  // Board membership/ownership is never proof of Workspace membership. Only
  // the current session's verified directory may supply protected identity.
  const boardWorkspace = boardName
    ? directory.workspaces.find((item) => item.id === board.data?.workspaceId)
    : undefined;

  return (
    <AppShell
      workspaceSlots={{
        switcher: (expanded) => (
          <WorkspaceSwitcher
            expanded={expanded}
            boardWorkspaceId={boardWorkspace?.id}
          />
        ),
        navigation: (expanded) => (
          <WorkspaceNavigation
            expanded={expanded}
            boardWorkspaceId={boardWorkspace?.id}
          />
        ),
      }}
      navGroups={navGroups}
      activeNavItemId={
        boardWorkspace ? undefined : findActiveNavItemId(navGroups, pathname)
      }
      headerContext={
        boardId &&
        boardName && (
          <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
            <ol className="flex min-w-0 items-center gap-2">
              {boardWorkspace && (
                <>
                  <li className="min-w-0 max-w-36">
                    <Link
                      to={workspacePath(boardWorkspace.id)}
                      title={boardWorkspace.name}
                      className="block truncate text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      {boardWorkspace.name}
                    </Link>
                  </li>
                  <li aria-hidden="true" className="text-muted">
                    <ChevronRightIcon className="size-4" />
                  </li>
                </>
              )}
              <li className="shrink-0">
                <Link
                  to={
                    boardWorkspace
                      ? `${workspacePath(boardWorkspace.id)}/boards`
                      : '/boards'
                  }
                  className="text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                >
                  Boards
                </Link>
              </li>
              <li aria-hidden="true" className="text-muted">
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
      headerActions={
        user && (
          <span role="img" aria-label={`Signed in as ${user.displayName}`}>
            <UserAvatar user={user} className="size-9 text-sm" />
          </span>
        )
      }
      sidebarFooter={(expanded) => (
        <UserMenu key={String(expanded)} expanded={expanded} />
      )}
      drawerFooter={<AccountLinks />}
    >
      <Outlet context={boardWorkspace} />
    </AppShell>
  );
}
