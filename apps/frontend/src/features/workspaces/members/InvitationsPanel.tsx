import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ActionMenu } from '../../../components/ActionMenu';
import { Alert } from '../../../components/Alert';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { MailIcon } from '../../../components/icons';
import { Pagination } from '../../../components/Pagination';
import { EmptyState } from '../../../components/states';
import { formatDate } from '../../../lib/format';
import { useAuth } from '../../auth/useAuth';
import { WorkspaceState } from '../components/WorkspaceState';
import type { WorkspaceViewState } from '../types';
import {
  useInviteWorkspaceMember,
  useRevokeWorkspaceInvitation,
  useWorkspaceInvitations,
} from './hooks';
import {
  inviteError,
  inviteOutcome,
  SEND_STATE_LABELS,
  STATUS_LABELS,
} from './invitation-text';
import { memberActionError, MEMBERS_PAGE_SIZE } from './MembersPanel';
import {
  INVITATION_STATUSES,
  type InvitationFilters,
  type WorkspaceInvitation,
} from './types';

const STATUS_STYLES = {
  PENDING: 'bg-[#fff4dc] text-[#8a5a00] dark:bg-[#3a2c10] dark:text-[#f3c66b]',
  ACCEPTED: 'bg-[#e3f6ea] text-[#1c7a43] dark:bg-[#173a28] dark:text-[#86d8a6]',
  EXPIRED: 'bg-app text-muted',
  REVOKED: 'bg-app text-muted',
} as const;

/** ADMIN-only invitation history with honest delivery state. */
export function InvitationsPanel({
  workspaceId,
  workspaceState,
  isAdmin,
  notice,
  onNotice,
}: {
  workspaceId: string;
  workspaceState: WorkspaceViewState;
  isAdmin: boolean;
  notice?: { tone: 'success' | 'error'; message: string };
  onNotice: (notice?: { tone: 'success' | 'error'; message: string }) => void;
}) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const status = params.get('status');
  const requestedPage = Number(params.get('page') ?? 1);
  const filters: InvitationFilters = {
    status: INVITATION_STATUSES.includes(status as never)
      ? (status as InvitationFilters['status'])
      : 'ALL',
    page:
      Number.isSafeInteger(requestedPage) &&
      requestedPage > 0 &&
      requestedPage <= 1000000
        ? requestedPage
        : 1,
    limit: MEMBERS_PAGE_SIZE,
  };
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in patch)) next.delete('page');
    void setParams(next, { replace: true });
  };
  const query = useWorkspaceInvitations(
    workspaceId,
    filters,
    workspaceState,
    isAdmin,
  );
  const revoke = useRevokeWorkspaceInvitation(workspaceId);
  const resend = useInviteWorkspaceMember(workspaceId);
  const [revoking, setRevoking] = useState<WorkspaceInvitation | null>(null);

  if (workspaceState === 'ready' && !isAdmin)
    return (
      <EmptyState
        icon={<MailIcon className="size-6" />}
        title="Invitations are managed by admins"
        description="Only workspace admins can see and send invitations."
      />
    );

  const sendAgain = (invitation: WorkspaceInvitation) => {
    if (resend.isPending) return;
    onNotice(undefined);
    resend.mutate(invitation.email, {
      onSuccess: (saved) => onNotice(inviteOutcome(saved)),
      onError: (error) =>
        onNotice({
          tone: 'error',
          message: inviteError(error).form ?? 'Could not send the invitation.',
        }),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          People must sign in with the invited email address to join.
        </p>
        <label className="sm:w-44">
          <span className="sr-only">Filter by status</span>
          <select
            value={filters.status}
            disabled={workspaceState !== 'ready'}
            onChange={(event) =>
              update({
                status:
                  event.target.value === 'ALL' ? null : event.target.value,
              })
            }
            className="h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-muted"
          >
            <option value="ALL">All statuses</option>
            {INVITATION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {notice && (
        <Alert variant={notice.tone}>
          <span role="status">{notice.message}</span>
        </Alert>
      )}
      {workspaceState === 'ready' && (
        <WorkspaceState
          state={query.state}
          retry={() => void query.refetch()}
        />
      )}
      {query.pageData?.items.length === 0 && (
        <EmptyState
          icon={<MailIcon className="size-6" />}
          title={
            filters.status === 'ALL'
              ? 'No invitations yet'
              : `No ${STATUS_LABELS[filters.status].toLowerCase()} invitations`
          }
          description="Invitations you send appear here with their status."
        />
      )}
      {!!query.pageData?.items.length && (
        <div className="rounded-xl border border-line bg-surface shadow-card">
          <table className="w-full text-left">
            <caption className="sr-only">Workspace invitations</caption>
            <thead className="border-b border-line text-xs text-muted">
              <tr className="[&>th]:bg-app/60 [&>th:first-child]:rounded-tl-xl [&>th:last-child]:rounded-tr-xl">
                <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">
                  Email
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-2.5 font-medium sm:table-cell"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-2.5 font-medium lg:table-cell"
                >
                  Invited by
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-2.5 font-medium md:table-cell"
                >
                  Expires
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-right font-medium sm:px-5"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {query.pageData.items.map((invitation) => {
                const badge = (
                  <span
                    className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap ${STATUS_STYLES[invitation.status]}`}
                  >
                    {STATUS_LABELS[invitation.status]}
                  </span>
                );
                // Terminal status wins; delivery only matters while pending.
                const delivery =
                  invitation.status === 'PENDING'
                    ? SEND_STATE_LABELS[invitation.sendState]
                    : undefined;
                const items =
                  invitation.status === 'PENDING'
                    ? [
                        {
                          label: 'Send again',
                          onSelect: () => sendAgain(invitation),
                        },
                        {
                          label: 'Revoke invitation',
                          tone: 'danger' as const,
                          onSelect: () => {
                            revoke.reset();
                            onNotice(undefined);
                            setRevoking(invitation);
                          },
                        },
                      ]
                    : invitation.status === 'ACCEPTED'
                      ? []
                      : [
                          {
                            label: 'Invite again',
                            onSelect: () => sendAgain(invitation),
                          },
                        ];
                return (
                  <tr key={invitation.id}>
                    <td className="w-full max-w-0 px-4 py-2.5 sm:px-5">
                      <p className="truncate text-sm font-medium text-ink">
                        {invitation.email}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        Sent{' '}
                        <time dateTime={invitation.createdAt}>
                          {formatDate(invitation.createdAt)}
                        </time>
                        {delivery && (
                          <span className="hidden sm:inline">
                            {' · '}
                            {delivery}
                          </span>
                        )}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 sm:hidden">
                        {badge}
                        {delivery && (
                          <span className="text-xs text-muted">{delivery}</span>
                        )}
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 sm:table-cell">
                      {badge}
                    </td>
                    <td className="hidden px-4 py-2.5 text-[13px] whitespace-nowrap text-muted lg:table-cell">
                      {invitation.invitedById === user?.id
                        ? 'You'
                        : 'Another admin'}
                    </td>
                    <td className="hidden px-4 py-2.5 text-[13px] whitespace-nowrap text-muted md:table-cell">
                      <time dateTime={invitation.expiresAt}>
                        {formatDate(invitation.expiresAt)}
                      </time>
                    </td>
                    <td className="px-2 py-2 text-right sm:px-5">
                      {items.length > 0 && (
                        <ActionMenu
                          label={`Actions for invitation to ${invitation.email}`}
                          className="inline-block [&>button]:size-11"
                          items={items}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {query.pageData && (
        <div className="space-y-3">
          <p role="status" className="text-xs text-muted">
            {query.pageData.total}{' '}
            {query.pageData.total === 1 ? 'invitation' : 'invitations'}
          </p>
          <Pagination
            label="Invitation pages"
            page={query.pageData.page}
            pageCount={query.pageData.pageCount}
            onChange={(page) =>
              update({ page: page > 1 ? String(page) : null })
            }
          />
        </div>
      )}
      {revoking && (
        <ConfirmDialog
          open
          title="Revoke this invitation?"
          description={`The link sent to ${revoking.email} stops working. You can invite them again later.`}
          confirmLabel="Revoke invitation"
          pendingLabel="Revoking…"
          pending={revoke.isPending}
          error={
            revoke.isError
              ? memberActionError(revoke.error, 'invitation')
              : undefined
          }
          onCancel={() => setRevoking(null)}
          onConfirm={() => {
            if (revoke.isPending) return;
            const email = revoking.email;
            revoke.mutate(revoking.id, {
              onSuccess: () => {
                setRevoking(null);
                onNotice({
                  tone: 'success',
                  message: `Invitation to ${email} was revoked.`,
                });
              },
            });
          }}
        />
      )}
    </div>
  );
}
