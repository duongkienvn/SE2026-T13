import { BoardRole } from '@kanban/shared';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ActionMenu } from '../../../components/ActionMenu';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { PlusIcon } from '../../../components/icons';
import { PageContainer } from '../../../components/PageContainer';
import { PageHeader } from '../../../components/PageHeader';
import { SearchField } from '../../../components/SearchField';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../../components/states';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { isApiError } from '../../../lib/api-client';
import { formatDate } from '../../../lib/format';
import { toFormErrors } from '../../../lib/form-errors';
import { UserAvatar } from '../../auth/components/UserAvatar';
import { useAuth } from '../../auth/useAuth';
import { RoleChip } from '../../boards/components/RoleChip';
import { useBoard } from '../../boards/hooks';
import {
  BoardUnavailable,
  isBoardUnavailable,
} from '../../boards/pages/BoardDetailPage';
import type { BoardsLocationState } from '../../boards/pages/BoardsPage';
import { AddMemberDialog } from '../components/AddMemberDialog';
import {
  useBoardMembers,
  useRemoveMember,
  useUpdateMemberRole,
} from '../hooks';
import { memberActionBlocks, sortMembers } from '../rules';
import type { BoardMember } from '../types';

/** Business-rule refusals (e.g. "last owner") carry a meaningful server message. */
function actionErrorMessage(error: unknown): string | undefined {
  if (
    isApiError(error) &&
    (error.status === 400 || error.status === 409 || error.status === 422) &&
    error.code !== 'VALIDATION_FAILED'
  ) {
    return error.message;
  }
  return toFormErrors(error, {}).formError;
}

export function BoardMembersPage() {
  const { boardId = '' } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const board = useBoard(boardId);
  const members = useBoardMembers(boardId);
  const updateRole = useUpdateMemberRole(boardId);
  const remove = useRemoveMember(boardId);

  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<BoardMember | null>(null);
  const [notice, setNotice] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  usePageTitle(board.data ? `Members · ${board.data.name}` : 'Members');

  const sorted = useMemo(() => sortMembers(members.data ?? []), [members.data]);
  const query = search.trim().toLowerCase();
  const visible = query
    ? sorted.filter((m) =>
        `${m.user.displayName} ${m.user.email}`.toLowerCase().includes(query),
      )
    : sorted;

  if (board.isPending || members.isPending) {
    return (
      <PageContainer>
        <LoadingState label="Loading members…" />
      </PageContainer>
    );
  }
  if (board.isError || members.isError) {
    const error = board.error ?? members.error;
    return (
      <PageContainer>
        {isBoardUnavailable(error) ? (
          <BoardUnavailable />
        ) : (
          <ErrorState
            title="We couldn't load the members"
            description="Check your connection and try again."
            onRetry={() => {
              void board.refetch();
              void members.refetch();
            }}
          />
        )}
      </PageContainer>
    );
  }

  const boardData = board.data;
  const all = members.data;
  // UI hint only: the backend enforces OWNER-only membership management.
  const canManage =
    boardData.currentUserRole === BoardRole.OWNER && !boardData.isArchived;

  const showNotice = (message: string) => {
    setActionError(undefined);
    setNotice(message);
  };

  const changeRole = (member: BoardMember, role: BoardRole) => {
    setNotice(undefined);
    setActionError(undefined);
    updateRole.mutate(
      { userId: member.user.id, role },
      {
        onSuccess: () =>
          showNotice(
            `${member.user.displayName} is now ${role === BoardRole.OWNER ? 'an owner' : 'a member'}.`,
          ),
        onError: (error) => setActionError(actionErrorMessage(error)),
      },
    );
  };

  const confirmRemove = () => {
    if (!removing) return;
    const member = removing;
    remove.mutate(member.user.id, {
      onSuccess: () => {
        setRemoving(null);
        if (member.user.id === currentUser?.id) {
          // Leaving the board removes access to it.
          const state: BoardsLocationState = {
            notice: `You left “${boardData.name}”.`,
          };
          navigate('/boards', { replace: true, state });
          return;
        }
        showNotice(`${member.user.displayName} was removed from the board.`);
      },
    });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Board members"
        description={`People who can access “${boardData.name}”.`}
        actions={
          <>
            {all.length > 1 && (
              <SearchField
                label="Search members"
                placeholder="Search members..."
                value={search}
                onChange={setSearch}
                className="w-full sm:w-[300px]"
              />
            )}
            {canManage && (
              <Button
                size="lg"
                onClick={() => {
                  setNotice(undefined);
                  setAdding(true);
                }}
              >
                <PlusIcon aria-hidden="true" className="size-5" />
                Add member
              </Button>
            )}
          </>
        }
      />

      <div className="mt-6 space-y-4">
        {notice && <Alert variant="success">{notice}</Alert>}
        {actionError && <Alert variant="error">{actionError}</Alert>}
      </div>

      <div className="mt-6">
        {visible.length === 0 ? (
          <EmptyState
            title="No matching members"
            description={`No member matches “${search.trim()}”.`}
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
            <table className="w-full text-left">
              <caption className="sr-only">Members of {boardData.name}</caption>
              <thead className="border-b border-line bg-app/60 text-[15px] text-muted">
                <tr>
                  <th scope="col" className="px-4 py-4 font-medium sm:px-6">
                    Member
                  </th>
                  <th
                    scope="col"
                    className="hidden px-4 py-4 font-medium sm:table-cell"
                  >
                    Role
                  </th>
                  <th
                    scope="col"
                    className="hidden px-4 py-4 font-medium md:table-cell"
                  >
                    Joined
                  </th>
                  {canManage && (
                    <th
                      scope="col"
                      className="px-6 py-4 text-right font-medium"
                    >
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((member) => {
                  const isSelf = member.user.id === currentUser?.id;
                  const blocks = memberActionBlocks(member, all, boardData);
                  const isOwner = member.role === BoardRole.OWNER;
                  return (
                    <tr key={member.user.id}>
                      {/* w-full + max-w-0 lets long names/emails truncate inside the table. */}
                      <td className="w-full max-w-0 px-4 py-4 sm:px-6">
                        <div className="flex items-center gap-3 sm:gap-4">
                          <UserAvatar user={member.user} className="size-12" />
                          <div className="min-w-0">
                            <p className="truncate text-[16px] font-semibold text-ink">
                              {member.user.displayName}
                              {isSelf && (
                                <span className="ml-1.5 font-normal text-muted">
                                  (you)
                                </span>
                              )}
                            </p>
                            <p className="truncate text-[15px] text-muted">
                              {member.user.email}
                            </p>
                            {/* Role column is hidden on phones; show it here instead. */}
                            <div className="mt-2 sm:hidden">
                              <RoleChip role={member.role} />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-4 py-4 sm:table-cell">
                        <RoleChip role={member.role} />
                      </td>
                      <td className="hidden px-4 py-4 text-[15px] text-muted md:table-cell">
                        <time dateTime={member.joinedAt}>
                          {formatDate(member.joinedAt)}
                        </time>
                      </td>
                      {canManage && (
                        <td className="px-2 py-4 text-right sm:px-6">
                          <ActionMenu
                            label={`Actions for ${member.user.displayName}`}
                            className="inline-block"
                            items={[
                              isOwner
                                ? {
                                    label: 'Make member',
                                    onSelect: () =>
                                      changeRole(member, BoardRole.MEMBER),
                                    disabledReason: blocks.demote,
                                  }
                                : {
                                    label: 'Make owner',
                                    onSelect: () =>
                                      changeRole(member, BoardRole.OWNER),
                                  },
                              {
                                label: isSelf
                                  ? 'Leave board'
                                  : 'Remove from board',
                                onSelect: () => {
                                  remove.reset();
                                  setRemoving(member);
                                },
                                tone: 'danger',
                                disabledReason: blocks.remove,
                              },
                            ]}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Mounted only while open so each opening starts with an empty form. */}
      {canManage && adding && (
        <AddMemberDialog
          boardId={boardId}
          boardName={boardData.name}
          open
          onClose={() => setAdding(false)}
          onAdded={(email) => {
            setAdding(false);
            showNotice(`${email} was added to the board.`);
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          open
          title={
            removing.user.id === currentUser?.id
              ? `Leave “${boardData.name}”?`
              : `Remove ${removing.user.displayName}?`
          }
          description={
            removing.user.id === currentUser?.id
              ? 'You will lose access to this board and its cards.'
              : 'They will lose access to this board, and their card assignments on it will be removed.'
          }
          confirmLabel={
            removing.user.id === currentUser?.id
              ? 'Leave board'
              : 'Remove member'
          }
          pendingLabel="Removing…"
          pending={remove.isPending}
          error={remove.isError ? actionErrorMessage(remove.error) : undefined}
          onCancel={() => setRemoving(null)}
          onConfirm={confirmRemove}
        />
      )}
    </PageContainer>
  );
}
