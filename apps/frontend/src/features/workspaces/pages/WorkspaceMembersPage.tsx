import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { SoonBadge } from '../../../app/layout/SoonBadge';
import { Button } from '../../../components/Button';
import {
  MailIcon,
  PlusIcon,
  UserIcon,
  UsersIcon,
} from '../../../components/icons';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { useAuthSession } from '../../auth/auth-session-context';
import { useWorkspacePage } from '../components/WorkspaceLayout';
import { InvitationsPanel } from '../members/InvitationsPanel';
import { InviteMemberDialog } from '../members/InviteMemberDialog';
import { inviteOutcome } from '../members/invitation-text';
import { MembersPanel } from '../members/MembersPanel';

type Notice = { tone: 'success' | 'error'; message: string };

export function WorkspaceMembersPage() {
  const { workspaceId = '' } = useParams();
  const { generation } = useAuthSession();
  return (
    <WorkspaceMembersContent
      key={`${generation}:${workspaceId}`}
      workspaceId={workspaceId}
    />
  );
}

function WorkspaceMembersContent({ workspaceId }: { workspaceId: string }) {
  const workspace = useWorkspacePage();
  const summary = workspace.overview?.workspace;
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<Notice>();
  const tab = params.get('tab') === 'invitations' ? 'invitations' : 'members';
  const isAdmin = summary?.role === 'ADMIN';
  const canInvite =
    workspace.state === 'ready' && summary?.type === 'TEAM' && isAdmin;
  const inviteReason = canInvite
    ? undefined
    : workspace.state !== 'ready'
      ? 'Invitations are unavailable while this workspace is being verified.'
      : summary?.type === 'PERSONAL'
        ? 'Personal workspaces are just for you. Create a team workspace to invite people.'
        : 'Only workspace admins can invite people.';
  usePageTitle(summary ? `${summary.name} · Members` : 'Workspace members');

  const go = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams();
    const keep = { tab: params.get('tab'), ...patch };
    for (const [key, value] of Object.entries(keep))
      if (value) next.set(key, value);
    void setParams(next, { replace });
  };
  const tabs = [
    { id: 'members', label: 'Members', icon: UsersIcon },
    { id: 'invitations', label: 'Invitations', icon: MailIcon },
  ] as const;

  return (
    <section aria-label="Workspace members" className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink">
            Members
          </h2>
          <p className="mt-1 text-sm text-muted">
            Manage workspace members and invitations.
          </p>
        </div>
        <Button
          size="lg"
          disabled={!canInvite}
          title={inviteReason}
          onClick={() => {
            setNotice(undefined);
            go({ invite: '1' });
          }}
        >
          <PlusIcon className="size-4" />
          Invite Member
        </Button>
      </header>
      {inviteReason && workspace.state === 'ready' && (
        <p className="text-xs leading-relaxed text-muted">{inviteReason}</p>
      )}
      <div
        role="tablist"
        aria-label="Member lists"
        className="flex gap-1 overflow-x-auto border-b border-line"
      >
        {tabs.map((item) => {
          const Icon = item.icon;
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`members-tab-${item.id}`}
              aria-selected={selected}
              aria-controls="members-tabpanel"
              tabIndex={selected ? 0 : -1}
              onClick={() =>
                go({ tab: item.id === 'members' ? null : item.id }, true)
              }
              onKeyDown={(event) => {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')
                  return;
                const other = tabs.find((candidate) => candidate !== item)!;
                go({ tab: other.id === 'members' ? null : other.id }, true);
                document.getElementById(`members-tab-${other.id}`)?.focus();
              }}
              className={`-mb-px flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:px-4 ${selected ? 'border-primary font-medium text-primary' : 'border-transparent text-muted hover:text-ink'}`}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </button>
          );
        })}
        <span
          aria-disabled="true"
          className="-mb-px flex min-h-11 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-sm text-muted sm:px-4"
        >
          <UserIcon className="size-4 shrink-0" />
          Guests
          <SoonBadge />
          <span className="sr-only">, coming soon</span>
        </span>
      </div>
      <div
        role="tabpanel"
        id="members-tabpanel"
        aria-labelledby={`members-tab-${tab}`}
      >
        {tab === 'members' ? (
          <MembersPanel
            workspaceId={workspaceId}
            workspace={summary}
            workspaceState={workspace.state}
          />
        ) : (
          <InvitationsPanel
            workspaceId={workspaceId}
            workspaceState={workspace.state}
            isAdmin={isAdmin}
            notice={notice}
            onNotice={setNotice}
          />
        )}
      </div>
      {params.get('invite') === '1' && canInvite && summary && (
        <InviteMemberDialog
          workspaceId={workspaceId}
          workspaceName={summary.name}
          onClose={() => go({ invite: null }, true)}
          onInvited={(invitation) => {
            setNotice(inviteOutcome(invitation));
            go({ tab: 'invitations', invite: null }, true);
          }}
        />
      )}
    </section>
  );
}
