import { Link, useParams } from 'react-router';
import { MailIcon, PlusIcon, UsersIcon } from '../../../components/icons';
import { workspacePath } from '../navigation';
import { useWorkspacePage } from '../components/WorkspaceLayout';
import { WorkspaceRoleChip } from '../members/WorkspaceRoleChip';
import { SettingsPanel } from './WorkspaceSettingsLayout';

const linkClass =
  'flex min-h-11 items-center gap-3 rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-ink hover:bg-app focus-visible:outline-2 focus-visible:outline-primary';

/** A summary that hands off to the real Members page (#117); no second roster. */
export function MembersSettings() {
  const { workspaceId = '' } = useParams();
  const workspace = useWorkspacePage();
  const summary = workspace.overview?.workspace;
  if (!summary) return null;
  const members = `${workspacePath(workspaceId)}/members`;
  const admin = summary.role === 'ADMIN';
  const team = summary.type === 'TEAM';
  const count = workspace.overview?.memberCount;
  return (
    <SettingsPanel
      title="Members & Invitations"
      description="People in this workspace and who can invite more."
    >
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-app/40 p-4">
          <dt className="text-xs text-muted">Members</dt>
          <dd className="mt-1 text-xl font-semibold text-ink">
            {count == null ? 'Unavailable' : count}
          </dd>
        </div>
        <div className="rounded-lg border border-line bg-app/40 p-4">
          <dt className="text-xs text-muted">Your role</dt>
          <dd className="mt-2">
            <WorkspaceRoleChip role={summary.role} />
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        {!team
          ? 'A personal workspace is just for you, so it has no invitations. Create a team workspace to work with others.'
          : admin
            ? 'As an admin you can invite people, change roles and remove members. Invitations always add a member.'
            : 'Only workspace admins can invite people or change roles. Ask an admin if someone should join.'}{' '}
        Workspace members never get access to a private board unless they are
        added to that board.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Link to={members} className={linkClass}>
          <UsersIcon className="size-4.5 shrink-0 text-muted" />
          View members
        </Link>
        {team && admin && (
          <>
            <Link to={`${members}?tab=invitations`} className={linkClass}>
              <MailIcon className="size-4.5 shrink-0 text-muted" />
              Manage invitations
            </Link>
            <Link
              to={`${members}?invite=1`}
              className={`${linkClass} border-primary/40 text-primary sm:col-span-2`}
            >
              <PlusIcon className="size-4.5 shrink-0" />
              Invite member
            </Link>
          </>
        )}
      </div>
    </SettingsPanel>
  );
}
