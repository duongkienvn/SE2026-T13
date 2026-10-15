import { BoardRole } from '@kanban/shared';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { ActionMenu } from '../../../components/ActionMenu';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { PlusIcon } from '../../../components/icons';
import { PageContainer } from '../../../components/PageContainer';
import { PageHeader } from '../../../components/PageHeader';
import { Pagination } from '../../../components/Pagination';
import { SearchField } from '../../../components/SearchField';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../../components/states';
import { useFitGrid } from '../../../hooks/useFitGrid';
import { usePageParam } from '../../../hooks/usePageParam';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { BOARD_ARCHIVED, isApiError } from '../../../lib/api-client';
import { formatDate } from '../../../lib/format';
import { paginate } from '../../../lib/pagination';
import { toFormErrors } from '../../../lib/form-errors';
import { UserAvatar } from '../../auth/components/UserAvatar';
import { useAuth } from '../../auth/useAuth';
import { RoleChip } from '../../boards/components/RoleChip';
import { useBoard } from '../../boards/hooks';
import {
  BoardUnavailable,
  isBoardUnavailable,
} from '../../boards/pages/BoardDetailPage';
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
    error.code !== 'VALIDATION_FAILED' &&
    error.code !== BOARD_ARCHIVED
  ) {
    return error.message;
  }
  return toFormErrors(error, {}).formError;
}

export function BoardMembersPage() {
  const { boardId = '' } = useParams();
  const { user: currentUser } = useAuth();
  const board = useBoard(boardId);
  const members = useBoardMembers(boardId);
  const updateRole = useUpdateMemberRole(boardId);
  const remove = useRemoveMember(boardId);

  // Rows that fit under the header row; the table border is the reserve.
  const fit = useFitGrid({ reserve: 2, fallbackRows: 8 });
  const [page, setPage] = usePageParam();
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
  const shown = paginate(visible, page, fit.pageSize);

  if (board.isPending || members.isPending) {
    return (
      <PageContainer>
        <LoadingState label="Loading members…" />
      </PageContainer>
    );
  }
  // A failed background refresh keeps the data on screen; only a failed first load
  // replaces the page.
  if ((board.isError && !board.data) || (members.isError && !members.data)) {
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

  const changeSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };
  const boardData = board.data!;
  const all = members.data!;
  // UI hint only: the backend enforces OWNER-only membership management.
  const canManage =
    boardData.currentUserRole === BoardRole.OWNER && !boardData.isArchived;

  const showNotice = (message: string) => {
    setActionError(undefined);
    setNotice(message);
  };

  const changeRole = (member: BoardMember, role: BoardRole) => {
    // One role change at a time; the list refreshes before the next one.
    if (updateRole.isPending) return;
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
        showNotice(`${member.user.displayName} was removed from the board.`);
      },
    });
  };

  return (
    <PageContainer fill>
      <PageHeader
        title="Board members"
        description={`People who can access “${boardData.name}”.`}
        actions={
          <>
            {/* Keep the box while a query is active, so it can always be cleared. */}
            {(all.length > 1 || search) && (
              <SearchField
                label="Search members"
                placeholder="Search members..."
                value={search}
                onChange={changeSearch}
                className="w-full sm:w-[280px]"
              />
            )}
            {canManage && (
              <Button
                onClick={() => {
                  setNotice(undefined);
                  setAdding(true);
                }}
              >
                <PlusIcon aria-hidden="true" className="size-4.5" />
                Add member
              </Button>
            )}
          </>
        }
      />

      {(notice || actionError) && (
        <div className="mt-4 space-y-3">
          {notice && <Alert variant="success">{notice}</Alert>}
          {actionError && <Alert variant="error">{actionError}</Alert>}
        </div>
      )}

      {/* Fills the remaining height; the page size is however many rows fit here. */}
      <div ref={fit.ref} className="mt-5 min-h-0 flex-1">
        {visible.length === 0 ? (
          <EmptyState
            title="No matching members"
            description={`No member matches “${search.trim()}”.`}
          />
        ) : (
          // No overflow clipping here: row action menus must be able to extend past it.
          <div className="rounded-xl border border-line bg-surface shadow-card">
            <table className="w-full text-left">
              <caption className="sr-only">Members of {boardData.name}</caption>
              <thead
                data-fit-fixed
                className="border-b border-line text-[13px] text-muted"
              >
                <tr className="[&>th]:bg-app/60 [&>th:first-child]:rounded-tl-xl [&>th:last-child]:rounded-tr-xl">
                  <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">
                    Member
                  </th>
                  <th
                    scope="col"
                    className="hidden px-4 py-2.5 font-medium whitespace-nowrap sm:table-cell"
                  >
                    Role
                  </th>
                  <th
                    scope="col"
                    className="hidden px-4 py-2.5 font-medium whitespace-nowrap md:table-cell"
                  >
                    Joined
                  </th>
                  {canManage && (
                    <th
                      scope="col"
                      className="px-5 py-2.5 text-right font-medium"
                    >
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.items.map((member) => {
                  const isSelf = member.user.id === currentUser?.id;
                  const blocks = memberActionBlocks(
                    member,
                    all,
                    boardData,
                    currentUser?.id,
                  );
                  const isOwner = member.role === BoardRole.OWNER;
                  return (
                    <tr key={member.user.id} data-fit-row>
                      {/* w-full + max-w-0 lets long names/emails truncate inside the table. */}
                      <td className="w-full max-w-0 px-4 py-2 sm:px-5">
                        <div className="flex items-center gap-3">
                          <UserAvatar
                            user={member.user}
                            className="size-9 text-[13px]"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink">
                              {member.user.displayName}
                              {isSelf && (
                                <span className="ml-1.5 font-normal text-muted">
                                  (you)
                                </span>
                              )}
                            </p>
                            <p className="truncate text-[13px] text-muted">
                              {member.user.email}
                            </p>
                            {/* Role column is hidden on phones; show it here instead. */}
                            <div className="mt-1 sm:hidden">
                              <RoleChip role={member.role} />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-4 py-2 whitespace-nowrap sm:table-cell">
                        <RoleChip role={member.role} />
                      </td>
                      <td className="hidden px-4 py-2 text-[13px] whitespace-nowrap text-muted md:table-cell">
                        <time dateTime={member.joinedAt}>
                          {formatDate(member.joinedAt)}
                        </time>
                      </td>
                      {canManage && (
                        <td className="px-2 py-2 text-right sm:px-5">
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
                                label: 'Remove from board',
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

      <Pagination
        label="Members pages"
        page={shown.page}
        pageCount={shown.pageCount}
        onChange={setPage}
        className="mt-4 shrink-0"
      />

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
          title={`Remove ${removing.user.displayName}?`}
          description="They will lose access to this board, and their card assignments on it will be removed."
          confirmLabel="Remove member"
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
