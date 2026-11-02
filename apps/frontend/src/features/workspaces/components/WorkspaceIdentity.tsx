import { Link, useLocation } from 'react-router';
import { buttonClassName } from '../../../components/Button';
import './workspace-overview.css';
import {
  ColumnsIcon,
  LayersIcon,
  PlusIcon,
  UsersIcon,
} from '../../../components/icons';
import { workspacePath } from '../navigation';
import { WorkspaceIconGlyph } from '../settings/icons';
import type { WorkspaceSummary } from '../types';

export function WorkspaceAvatar({
  workspace,
  className = 'size-12 text-lg',
}: {
  workspace?: WorkspaceSummary;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-xl bg-primary-solid font-semibold text-white ${className}`}
    >
      {workspace?.icon ? (
        <WorkspaceIconGlyph icon={workspace.icon} className="size-1/2" />
      ) : workspace ? (
        workspace.name.trim().slice(0, 1).toLocaleUpperCase()
      ) : (
        <LayersIcon className="size-1/2" />
      )}
    </span>
  );
}

export function WorkspaceIdentity({
  workspace,
  memberCount,
  visibleBoardCount,
  showCreateBoard = false,
  loading = false,
}: {
  workspace?: WorkspaceSummary;
  memberCount?: number | null;
  visibleBoardCount?: number | null;
  showCreateBoard?: boolean;
  loading?: boolean;
}) {
  const location = useLocation();
  const membersPath = workspace ? `${workspacePath(workspace.id)}/members` : '';
  const inviteParams = new URLSearchParams(
    location.pathname.replace(/\/+$/, '') === membersPath
      ? location.search
      : undefined,
  );
  inviteParams.set('invite', '1');
  return (
    <header className="workspace-hero my-4 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-4 rounded-2xl border border-primary/15 p-4 sm:gap-x-5 sm:p-5 xl:grid-cols-[auto_minmax(0,1fr)_auto] xl:items-center">
      <WorkspaceAvatar
        workspace={workspace}
        className="size-12 text-xl shadow-card sm:size-16 sm:text-2xl"
      />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1
            title={workspace?.name}
            className="line-clamp-2 min-w-0 max-w-full text-xl leading-tight font-bold tracking-tight text-ink sm:text-2xl [overflow-wrap:anywhere]"
          >
            {workspace?.name ??
              (loading ? 'Loading workspace…' : 'Workspace overview')}
          </h1>
          {workspace && (
            <span className="rounded-md bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary-hover">
              {workspace.type === 'PERSONAL' ? 'Personal' : 'Team'}
            </span>
          )}
        </div>
        <p
          title={workspace?.description ?? undefined}
          className="mt-1.5 line-clamp-1 text-sm sm:line-clamp-2 leading-relaxed text-muted [overflow-wrap:anywhere]"
        >
          {workspace?.description ||
            (workspace
              ? 'A shared space for your boards and ideas.'
              : 'Your boards, people and work, together in one place.')}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs leading-5 text-muted">
          {visibleBoardCount != null && (
            <span className="inline-flex items-center gap-1.5">
              <ColumnsIcon className="size-3.5 shrink-0" />
              {visibleBoardCount} {visibleBoardCount === 1 ? 'board' : 'boards'}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <UsersIcon className="size-3.5 shrink-0" />
            {memberCount != null
              ? `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`
              : 'Member summary unavailable'}
          </span>
          {workspace && (
            <span className="hidden items-center gap-1.5 sm:inline-flex">
              <LayersIcon className="size-3.5 shrink-0" />
              {workspace.type === 'PERSONAL'
                ? 'Personal workspace'
                : 'Team workspace'}
            </span>
          )}
        </div>
      </div>
      {workspace &&
        ((workspace.type === 'TEAM' && workspace.role === 'ADMIN') ||
          (showCreateBoard && workspace.canCreateBoards)) && (
          <div className="col-span-2 flex flex-col gap-2 sm:flex-row sm:justify-end xl:col-span-1">
            {workspace.type === 'TEAM' && workspace.role === 'ADMIN' && (
              <Link
                to={`${membersPath}?${inviteParams}`}
                className={`${buttonClassName('secondary', 'lg')} whitespace-nowrap`}
              >
                <UsersIcon className="size-4" />
                Invite
              </Link>
            )}
            {showCreateBoard && workspace.canCreateBoards && (
              <Link
                to={`${workspacePath(workspace.id)}/boards?create=board`}
                className={`${buttonClassName('primary', 'lg')} whitespace-nowrap`}
              >
                <PlusIcon className="size-4" />
                Create Board
              </Link>
            )}
          </div>
        )}
    </header>
  );
}
