import { Link, useLocation } from 'react-router';
import { LayersIcon, PlusIcon, UserIcon } from '../../../components/icons';
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
  loading = false,
}: {
  workspace?: WorkspaceSummary;
  memberCount?: number | null;
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
    <header className="flex flex-wrap items-center gap-4 py-6">
      <WorkspaceAvatar
        workspace={workspace}
        className="size-16 text-2xl sm:size-18"
      />
      <div className="min-w-0 flex-1 basis-40">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 max-w-full text-xl font-semibold tracking-tight text-ink sm:text-2xl [overflow-wrap:anywhere]">
            {workspace?.name ??
              (loading ? 'Loading workspace…' : 'Workspace overview')}
          </h1>
          {workspace && (
            <span className="rounded-md bg-primary-soft px-2 py-1 text-xs font-medium text-primary">
              {workspace.type === 'PERSONAL' ? 'Personal' : 'Team'}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-sm leading-relaxed break-words text-muted [overflow-wrap:anywhere]">
          {workspace?.description ||
            (workspace
              ? 'A shared space for your boards and ideas.'
              : 'Your boards, people and work, together in one place.')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        <span className="flex items-center gap-2">
          <UserIcon className="size-4" />
          {memberCount != null
            ? `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`
            : 'Member summary unavailable'}
        </span>
        {workspace?.type === 'TEAM' && workspace.role === 'ADMIN' ? (
          <Link
            to={`${membersPath}?${inviteParams}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-primary hover:bg-primary-soft/40 focus-visible:outline-2 focus-visible:outline-primary"
          >
            <PlusIcon className="size-4" />
            Invite
          </Link>
        ) : (
          <span
            aria-disabled="true"
            title={
              workspace?.type === 'PERSONAL'
                ? 'Personal workspaces are just for you.'
                : 'Only workspace admins can invite people.'
            }
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-xs"
          >
            <PlusIcon className="size-4" />
            Invite
            <span className="sr-only">
              , unavailable:{' '}
              {workspace?.type === 'PERSONAL'
                ? 'personal workspaces are just for you'
                : 'only workspace admins can invite people'}
            </span>
          </span>
        )}
      </div>
    </header>
  );
}
