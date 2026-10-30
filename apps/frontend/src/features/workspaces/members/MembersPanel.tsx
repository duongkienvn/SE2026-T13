import { WorkspaceRole } from '@kanban/shared';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ActionMenu } from '../../../components/ActionMenu';
import { Alert } from '../../../components/Alert';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { Pagination } from '../../../components/Pagination';
import { SearchField } from '../../../components/SearchField';
import { EmptyState } from '../../../components/states';
import { UsersIcon } from '../../../components/icons';
import { isApiError } from '../../../lib/api-client';
import { formatDate } from '../../../lib/format';
import { UserAvatar } from '../../auth/components/UserAvatar';
import { useAuth } from '../../auth/useAuth';
import { WorkspaceState } from '../components/WorkspaceState';
import type { WorkspaceSummary, WorkspaceViewState } from '../types';
import {
  useChangeMemberRole,
  useRemoveWorkspaceMember,
  useWorkspaceMembers,
} from './hooks';
import type { MemberFilters, WorkspaceMember } from './types';
import { WorkspaceRoleChip } from './WorkspaceRoleChip';

export const MEMBERS_PAGE_SIZE = 10;

/** Server refusals (last ADMIN, self change, lost permission) in plain words. */
export function memberActionError(
  error: unknown,
  subject: 'member' | 'invitation' = 'member',
): string {
  if (!isApiError(error)) return 'Something went wrong. Please try again.';
  if (error.status === 403)
    return 'Only workspace admins can do this. Your role may have changed.';
  if (error.status === 404)
    return subject === 'member'
      ? 'This member is no longer in the workspace. The list has been refreshed.'
      : 'This invitation no longer exists. The list has been refreshed.';
  if (error.status === 409)
    return `${error.message.replace(/\.$/, '')}. The list has been refreshed.`;
  if (error.status === 429)
    return 'Too many requests. Wait a moment and try again.';
  return 'Could not save the change. Check your connection and try again.';
}

type PendingAction =
  | { kind: 'role'; member: WorkspaceMember; role: WorkspaceRole }
  | { kind: 'remove'; member: WorkspaceMember };

function useMemberFilters() {
  const [params, setParams] = useSearchParams();
  const requestedPage = Number(params.get('page') ?? 1);
  const role = params.get('role');
  const draft = (params.get('q') ?? '').slice(0, 120);
  const [settled, setSettled] = useState(draft.trim());
  useEffect(() => {
    const timer = setTimeout(() => setSettled(draft.trim()), draft ? 300 : 0);
    return () => clearTimeout(timer);
  }, [draft]);
  const filters: MemberFilters = {
    search: settled,
    role: role === 'ADMIN' || role === 'MEMBER' ? role : 'ALL',
    page:
      Number.isSafeInteger(requestedPage) &&
      requestedPage > 0 &&
      requestedPage <= 1000000
        ? requestedPage
        : 1,
    limit: MEMBERS_PAGE_SIZE,
  };
  const update = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in patch)) next.delete('page');
    void setParams(next, { replace, flushSync: true });
  };
  return {
    filters,
    draft,
    debouncing: draft.trim() !== settled,
    filtered: !!draft.trim() || filters.role !== 'ALL',
    search: (value: string) => update({ q: value || null }, true),
    role: (value: string) => update({ role: value === 'ALL' ? null : value }),
    page: (value: number) =>
      update({ page: value > 1 ? String(value) : null }, true),
  };
}

export function MembersPanel({
  workspaceId,
  workspace,
  workspaceState,
}: {
  workspaceId: string;
  workspace?: WorkspaceSummary;
  workspaceState: WorkspaceViewState;
}) {
  const { user } = useAuth();
  const control = useMemberFilters();
  const query = useWorkspaceMembers(
    workspaceId,
    control.filters,
    control.debouncing && workspaceState === 'ready'
      ? 'loading'
      : workspaceState,
  );
  const changeRole = useChangeMemberRole(workspaceId);
  const remove = useRemoveWorkspaceMember(workspaceId);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [notice, setNotice] = useState<string>();
  // Team ADMIN only; the server re-checks every command.
  const canManage = workspace?.type === 'TEAM' && workspace.role === 'ADMIN';
  const active = pending?.kind === 'remove' ? remove : changeRole;
  const ready = query.state === 'ready';
  useEffect(() => {
    const page = query.pageData;
    // Placeholder rows belong to the previous filters/page. Only the current
    // server response can tell us that deletion or a role change shrank it.
    if (!page || query.isPlaceholderData || query.isFetching) return;
    const lastPage = Math.max(1, page.pageCount);
    if (control.filters.page > lastPage) control.page(lastPage);
  }, [query.pageData, query.isPlaceholderData, query.isFetching, control]);

  const confirm = () => {
    if (!pending || active.isPending) return;
    const { member } = pending;
    const done = (message: string) => {
      setPending(null);
      setNotice(message);
    };
    if (pending.kind === 'remove')
      remove.mutate(member.userId, {
        onSuccess: () =>
          done(`${member.displayName} was removed from the workspace.`),
      });
    else
      changeRole.mutate(
        { userId: member.userId, role: pending.role },
        {
          onSuccess: (saved) =>
            done(
              `${saved.displayName} is now ${saved.role === 'ADMIN' ? 'an admin' : 'a member'}.`,
            ),
        },
      );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <SearchField
          label="Search members"
          placeholder="Search members..."
          value={control.draft}
          onChange={control.search}
          disabled={workspaceState !== 'ready'}
          className="min-w-0 flex-1"
        />
        <label className="sm:w-44">
          <span className="sr-only">Filter by role</span>
          <select
            value={control.filters.role}
            disabled={workspaceState !== 'ready'}
            onChange={(event) => control.role(event.target.value)}
            className="h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-muted"
          >
            <option value="ALL">All roles</option>
            <option value="ADMIN">Admin</option>
            <option value="MEMBER">Member</option>
          </select>
        </label>
      </div>
      {notice && (
        <Alert variant="success">
          <span role="status">{notice}</span>
        </Alert>
      )}
      {workspaceState === 'ready' && (
        <WorkspaceState
          state={query.state}
          retry={() => void query.refetch()}
        />
      )}
      {ready && query.pageData?.items.length === 0 && (
        <EmptyState
          icon={<UsersIcon className="size-6" />}
          title={control.filtered ? 'No matching members' : 'No members yet'}
          description={
            control.filtered
              ? 'Try another name or role.'
              : 'Members appear here after they join.'
          }
        />
      )}
      {ready && !!query.pageData?.items.length && (
        // No overflow clipping: row action menus must extend past the table.
        <div className="rounded-xl border border-line bg-surface shadow-card">
          <table className="w-full text-left">
            <caption className="sr-only">
              Members of {workspace?.name ?? 'this workspace'}
            </caption>
            <thead className="border-b border-line text-xs text-muted">
              <tr className="[&>th]:bg-app/60 [&>th:first-child]:rounded-tl-xl [&>th:last-child]:rounded-tr-xl">
                <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">
                  Name
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-2.5 font-medium sm:table-cell"
                >
                  Role
                </th>
                <th
                  scope="col"
                  className="hidden px-4 py-2.5 font-medium md:table-cell"
                >
                  Joined
                </th>
                <th
                  scope="col"
                  className="px-4 py-2.5 text-right font-medium sm:px-5"
                >
                  <span className={canManage ? '' : 'sr-only'}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {query.pageData.items.map((member) => {
                const self = member.userId === user?.id;
                return (
                  <tr key={member.userId}>
                    <td className="w-full max-w-0 px-4 py-2 sm:px-5">
                      <div className="flex items-center gap-3">
                        <UserAvatar
                          user={{
                            id: member.userId,
                            displayName: member.displayName,
                            avatarUrl: member.avatarUrl,
                          }}
                          className="size-9 text-[13px]"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">
                            {member.displayName}
                            {self && (
                              <span className="ml-1.5 font-normal text-muted">
                                (you)
                              </span>
                            )}
                          </p>
                          <div className="mt-1 sm:hidden">
                            <WorkspaceRoleChip role={member.role} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-2 sm:table-cell">
                      <WorkspaceRoleChip role={member.role} />
                    </td>
                    <td className="hidden px-4 py-2 text-[13px] whitespace-nowrap text-muted md:table-cell">
                      <time dateTime={member.joinedAt}>
                        {formatDate(member.joinedAt)}
                      </time>
                    </td>
                    <td className="px-2 py-2 text-right sm:px-5">
                      {canManage && !self && (
                        <ActionMenu
                          label={`Actions for ${member.displayName}`}
                          className="inline-block [&>button]:size-11"
                          items={[
                            {
                              label:
                                member.role === 'ADMIN'
                                  ? 'Make member'
                                  : 'Make admin',
                              onSelect: () => {
                                changeRole.reset();
                                setNotice(undefined);
                                setPending({
                                  kind: 'role',
                                  member,
                                  role:
                                    member.role === 'ADMIN'
                                      ? WorkspaceRole.MEMBER
                                      : WorkspaceRole.ADMIN,
                                });
                              },
                            },
                            {
                              label: 'Remove from workspace',
                              tone: 'danger',
                              onSelect: () => {
                                remove.reset();
                                setNotice(undefined);
                                setPending({ kind: 'remove', member });
                              },
                            },
                          ]}
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
            {query.pageData.total === 1 ? 'member' : 'members'}
            {control.filtered ? ' matching these filters' : ''}
          </p>
          <Pagination
            label="Workspace members pages"
            page={query.pageData.page}
            pageCount={query.pageData.pageCount}
            onChange={control.page}
          />
        </div>
      )}
      {canManage && pending && (
        <ConfirmDialog
          open
          title={
            pending.kind === 'remove'
              ? `Remove ${pending.member.displayName}?`
              : pending.role === 'ADMIN'
                ? `Make ${pending.member.displayName} an admin?`
                : `Remove admin rights from ${pending.member.displayName}?`
          }
          description={
            pending.kind === 'remove'
              ? 'They lose access to this workspace and its workspace-visible boards. Boards they were added to directly stay shared with them as a guest.'
              : pending.role === 'ADMIN'
                ? 'Admins can invite people, change roles and remove members. Private boards stay private.'
                : 'They stay in the workspace as a member and can no longer manage members or invitations.'
          }
          confirmLabel={
            pending.kind === 'remove'
              ? 'Remove member'
              : pending.role === 'ADMIN'
                ? 'Make admin'
                : 'Make member'
          }
          pendingLabel={pending.kind === 'remove' ? 'Removing…' : 'Saving…'}
          confirmVariant={
            pending.kind === 'role' && pending.role === 'ADMIN'
              ? 'primary'
              : 'danger'
          }
          pending={active.isPending}
          error={active.isError ? memberActionError(active.error) : undefined}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </div>
  );
}
