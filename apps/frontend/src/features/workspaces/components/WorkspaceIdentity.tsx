import { LayersIcon, UserIcon } from '../../../components/icons';
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
      {workspace ? (
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
        <span
          aria-disabled="true"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-xs"
        >
          Invite <span className="text-muted">Soon</span>
        </span>
      </div>
    </header>
  );
}
