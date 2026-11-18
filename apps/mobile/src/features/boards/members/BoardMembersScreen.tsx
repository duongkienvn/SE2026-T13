import { BoardRole } from '@kanban/shared';
import { useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../../../infrastructure/api/errors';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../../infrastructure/api/session-client';
import { useSessionSnapshot } from '../../../infrastructure/auth/SessionProvider';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { queryKeys } from '../../../infrastructure/query/keys';
import {
  useBoardRealtime,
  useRealtime,
} from '../../../infrastructure/realtime/RealtimeProvider';
import { ResourceBoundary } from '../../../navigation/resource-boundary';
import type { ResourceId } from '../../../navigation/routes';
import {
  BottomSheet,
  Button,
  ConfirmDialog,
  ErrorState,
  ScreenHeader,
  SegmentedControl,
  Skeleton,
  StatusChip,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import {
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from '../../workspaces/status';
import { isAccessDenied } from '../kanban-api';
import { AddBoardMemberSheet } from './AddBoardMemberSheet';
import { BoardMemberAvatar } from './BoardMemberAvatar';
import type { BoardMember } from './api';
import {
  changeBoardMembership,
  memberActionBlock,
  uncertainBoardMembershipWrite,
  type BoardMembershipCommand,
} from './mutations';
import {
  boardMembershipAccessOptions,
  boardMembershipPermissions,
  boardPolicyOptions,
  useBoardMembers,
} from './queries';

type Selection = {
  member: BoardMember;
  kind: 'actions' | 'role' | 'confirm-role' | 'remove';
  role: BoardRole;
};

export function BoardMembersScreen({
  boardId,
}: {
  boardId: ResourceId | null;
}) {
  const session = useSessionSnapshot();
  const identity = useMemo(
    () =>
      session.status === 'authenticated'
        ? { userId: session.user.id, generation: session.generation }
        : null,
    [session],
  );
  if (!identity || !boardId) return <ResourceBoundary access="unavailable" />;
  return (
    <MembersScreen
      key={`${identity.userId}:${identity.generation}:${boardId}`}
      identity={identity}
      boardId={boardId}
    />
  );
}

function MembersScreen({
  identity,
  boardId,
}: {
  identity: SessionIdentity;
  boardId: ResourceId;
}) {
  const data = useMobileData();
  const realtime = useRealtime();
  const c = useTheme();
  const focused = useIsFocused();
  const online = useWorkspaceOnline();
  const room = useBoardRealtime(boardId, focused, true);
  const checking = room.status === 'checking';
  const revoked = room.status === 'unavailable';
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [selection, setSelection] = useState<Selection>();
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ error: unknown; at: number }>();
  const [mustReview, setMustReview] = useState(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      request.current?.abort();
    },
    [],
  );
  const detail = useQuery({
    ...boardMembershipAccessOptions(data, identity, boardId),
    enabled: focused && online && !checking && !revoked,
  });
  const board = detail.data;
  const verified =
    focused &&
    online &&
    !checking &&
    !revoked &&
    detail.isSuccess &&
    detail.isFetchedAfterMount &&
    !detail.isFetching &&
    data.resources.readable(queryKeys.board(identity, boardId));
  const permissions = boardMembershipPermissions(
    verified ? board : undefined,
    undefined,
  );
  const members = useBoardMembers(
    data,
    identity,
    boardId,
    page,
    verified && permissions.canReadMembers,
  );
  const policy = useQuery({
    ...boardPolicyOptions(data, identity, boardId),
    enabled:
      verified &&
      board?.currentUserRole === BoardRole.OWNER &&
      !board.isArchived,
  });
  const policyCurrent =
    policy.isSuccess && policy.isFetchedAfterMount && !policy.isFetching;
  const rights = boardMembershipPermissions(
    verified ? board : undefined,
    policyCurrent ? policy.data : undefined,
  );
  const retry = useWorkspaceRetryReady(failure?.error, failure?.at ?? 0);
  const readRetry = useWorkspaceRetryReady(
    members.error ?? detail.error,
    members.error ? members.errorUpdatedAt : detail.errorUpdatedAt,
  );
  const policyRetry = useWorkspaceRetryReady(
    policy.error,
    policy.errorUpdatedAt,
  );
  const rosterCurrent =
    verified &&
    permissions.canReadMembers &&
    members.isSuccess &&
    members.isFetchedAfterMount &&
    !members.isFetching;
  const blocked =
    pending || !!request.current || !retry || mustReview || !rosterCurrent;
  const selected = rosterCurrent
    ? members.data?.data.find(({ id }) => id === selection?.member.id)
    : undefined;
  const stale =
    !!selection &&
    (!selected ||
      selected.role !== selection.member.role ||
      selected.user.id !== selection.member.user.id);
  // A partial page cannot establish the total number of owners. The actor's
  // freshly verified OWNER membership also counts, even on another page.
  const knownOwners =
    board?.currentUserRole === BoardRole.OWNER &&
    selection?.member.user.id !== identity.userId &&
    selection?.member.role === BoardRole.OWNER
      ? 2
      : undefined;
  const block =
    selection && board
      ? memberActionBlock(selection.member, board, identity.userId, knownOwners)
      : undefined;

  useEffect(() => {
    if (isAccessDenied(detail.error)) realtime.revokeBoard(boardId);
  }, [detail.error, realtime, boardId]);
  useEffect(() => {
    if (
      revoked ||
      checking ||
      !data.resources.readable(queryKeys.board(identity, boardId)) ||
      (detail.isSuccess &&
        board &&
        (board.currentUserRole !== BoardRole.OWNER || board.isArchived))
    ) {
      setAdding(false);
      setEmail('');
      setSelection(undefined);
      setNotice('');
    }
  }, [detail.isSuccess, board, revoked, checking, data, identity, boardId]);
  useEffect(() => {
    if (!members.isSuccess || members.isFetching) return;
    const last = Math.max(1, members.data.meta.totalPages);
    if (page > last) setPage(last);
  }, [members.isSuccess, members.isFetching, members.data, page]);

  async function run(command: BoardMembershipCommand) {
    if (
      request.current ||
      blocked ||
      (command.kind === 'add' ? !rights.canAdd : !rights.canChange)
    )
      return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setFailure(undefined);
    setNotice('');
    const current = () =>
      mounted.current && sameIdentity(identity, data.getIdentity());
    try {
      await changeBoardMembership(
        data,
        identity,
        boardId,
        command,
        controller.signal,
      );
      if (!current()) return;
      setAdding(false);
      setEmail('');
      setSelection(undefined);
      setNotice(
        command.kind === 'add'
          ? 'Board member added.'
          : command.kind === 'remove'
            ? 'Board member removed. Card assignments cleared.'
            : 'Board role updated.',
      );
    } catch (error) {
      if (!current()) return;
      setFailure({ error, at: Date.now() });
      if (uncertainBoardMembershipWrite(error)) setMustReview(true);
    } finally {
      if (request.current === controller) request.current = null;
      if (current()) setPending(false);
    }
  }

  async function review() {
    if (!online || pending || !retry) return;
    const access = await detail.refetch();
    if (!access.isSuccess || !access.data.currentUserRole) return;
    const roster = await members.refetch();
    if (
      !roster.isSuccess ||
      !mounted.current ||
      !sameIdentity(identity, data.getIdentity())
    )
      return;
    setMustReview(false);
    setFailure(undefined);
    setAdding(false);
    setEmail('');
    setSelection(undefined);
    setNotice(
      'Latest members loaded. Review the roster before choosing another change.',
    );
  }

  const errorMessage = mustReview
    ? 'This change may have reached the server. Check the latest members before trying again.'
    : failure?.error instanceof ApiError && failure.error.status === 404
      ? 'This registered user or membership is unavailable. Refresh members to check access.'
      : failure?.error instanceof ApiError && failure.error.status === 403
        ? 'Current Board role or Workspace policy does not allow this change.'
        : failure
          ? workspaceErrorMessage(failure.error)
          : undefined;
  const reviewButton = mustReview ? (
    <Button
      label="Check latest members"
      disabled={
        !online || pending || !retry || detail.isFetching || members.isFetching
      }
      onPress={() => void review()}
    />
  ) : undefined;
  const shell = (children: React.ReactNode) => (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      <View style={{ padding: spacing.lg, gap: spacing.lg, flex: 1 }}>
        <ScreenHeader title="Board members" />
        {children}
      </View>
    </SafeAreaView>
  );

  if (revoked || isAccessDenied(detail.error))
    return shell(
      <ErrorState
        title="Board unavailable"
        description="This destination is unavailable."
      />,
    );
  if (!online || detail.isPaused)
    return shell(
      <ErrorState
        title="Connection unavailable"
        description="Reconnect to verify Board membership."
      />,
    );
  if (detail.isError && !detail.isFetching && !checking)
    return shell(
      <ErrorState
        title="Couldn’t check Board access"
        description={workspaceErrorMessage(detail.error)}
        action={
          <Button
            label="Retry Board access"
            disabled={!readRetry}
            onPress={() => void detail.refetch()}
          />
        }
      />,
    );
  if (!verified || !board)
    return shell(
      <>
        <Skeleton height={64} label="Checking Board membership" />
        <Skeleton height={120} />
      </>,
    );
  if (!permissions.canReadMembers)
    return shell(
      <ErrorState
        title="Board member access restricted"
        description="You can read this Board through Workspace visibility. Only explicit Board members can view its member list. Workspace roles do not grant access to this list."
      />,
    );

  const open = (member: BoardMember) => {
    setFailure(undefined);
    setNotice('');
    setSelection({ member, kind: 'actions', role: member.role });
  };
  const header = (
    <View style={{ gap: spacing.lg }}>
      <ScreenHeader title="Board members" subtitle={board.name} />
      <Text style={[typography.body, { color: c.textSecondary }]}>
        People explicitly added to this Board. Board roles are separate from
        Workspace roles.
      </Text>
      {board.isArchived && (
        <Text style={[typography.body, { color: c.warning }]}>
          Archived Board · Members are read only.
        </Text>
      )}
      {board.currentUserRole === BoardRole.MEMBER && (
        <Text style={[typography.supporting, { color: c.textSecondary }]}>
          Only a Board OWNER can manage members.
        </Text>
      )}
      {board.currentUserRole === BoardRole.OWNER && !board.isArchived && (
        <>
          {policy.isPending || policy.isFetching ? (
            <Skeleton height={48} label="Checking membership policy" />
          ) : policy.isError ? (
            <Button
              label="Retry membership policy"
              disabled={!policyRetry}
              onPress={() => void policy.refetch()}
            />
          ) : (
            <>
              {rights.canAdd ? (
                <Button
                  label="Add existing Kanvexa user"
                  disabled={blocked}
                  onPress={() => {
                    setFailure(undefined);
                    setNotice('');
                    setAdding(true);
                  }}
                />
              ) : (
                <Text
                  style={[typography.supporting, { color: c.textSecondary }]}
                >
                  Workspace policy does not allow adding Board members.
                </Text>
              )}
              {!rights.canChange && (
                <Text
                  style={[typography.supporting, { color: c.textSecondary }]}
                >
                  Workspace policy does not allow changing or removing Board
                  memberships.
                </Text>
              )}
            </>
          )}
        </>
      )}
      {!!notice && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: c.text }]}
        >
          {notice}
        </Text>
      )}
      {!!errorMessage && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: c.danger }]}
        >
          {errorMessage}
        </Text>
      )}
      {!adding && reviewButton}
      {rosterCurrent && members.data && (
        <Text
          accessibilityLiveRegion="polite"
          style={[
            typography.supporting,
            typography.numeric,
            { color: c.textSecondary },
          ]}
        >
          {members.data.meta.total} Board{' '}
          {members.data.meta.total === 1 ? 'member' : 'members'} · Page {page}{' '}
          of {Math.max(1, members.data.meta.totalPages)}
        </Text>
      )}
    </View>
  );
  return (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      <FlatList
        data={rosterCurrent ? (members.data?.data ?? []) : []}
        keyExtractor={(member) => member.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        renderItem={({ item: member }) => (
          <Surface>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: spacing.md,
              }}
            >
              <BoardMemberAvatar
                member={member}
                identity={identity}
                boardId={boardId}
              />
              <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
                <Text style={[typography.strong, { color: c.text }]}>
                  {member.user.displayName}
                  {member.user.id === identity.userId ? ' · You' : ''}
                </Text>
                <Text
                  selectable
                  style={[typography.supporting, { color: c.textSecondary }]}
                >
                  {member.user.isDeleted
                    ? 'Deleted account'
                    : member.user.email}
                </Text>
                <View style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
                  <StatusChip label={`Board ${member.role}`} />
                </View>
                <Text
                  style={[typography.supporting, { color: c.textSecondary }]}
                >
                  Joined {new Date(member.joinedAt).toLocaleDateString()}
                </Text>
              </View>
            </View>
            {rights.canChange && (
              <Button
                label={`Actions for ${member.user.displayName}`}
                variant="link"
                disabled={
                  blocked || !!memberActionBlock(member, board, identity.userId)
                }
                onPress={() => open(member)}
              />
            )}
            {!!memberActionBlock(member, board, identity.userId) && (
              <Text style={[typography.supporting, { color: c.textSecondary }]}>
                {memberActionBlock(member, board, identity.userId)}
              </Text>
            )}
          </Surface>
        )}
        ListEmptyComponent={
          members.isError ? (
            <ErrorState
              title={
                isAccessDenied(members.error)
                  ? 'Board member access restricted'
                  : 'Couldn’t load Board members'
              }
              description="The member list is unavailable. Refresh to check current Board access."
              action={
                <Button
                  label="Retry members"
                  disabled={!readRetry || members.isFetching}
                  onPress={() => void review()}
                />
              }
            />
          ) : members.isFetching || !members.isFetchedAfterMount ? (
            <Skeleton height={120} label="Loading Board members" />
          ) : (
            <Text style={[typography.body, { color: c.textSecondary }]}>
              No explicit Board members were returned. Refresh to check the
              latest membership.
            </Text>
          )
        }
        ListFooterComponent={
          <View style={{ gap: spacing.sm }}>
            {rosterCurrent && page > 1 && (
              <Button
                label="Previous page"
                variant="secondary"
                disabled={pending}
                onPress={() => {
                  setSelection(undefined);
                  setPage(page - 1);
                }}
              />
            )}
            {rosterCurrent &&
              members.data &&
              page < members.data.meta.totalPages && (
                <Button
                  label="Next page"
                  variant="secondary"
                  disabled={pending}
                  onPress={() => {
                    setSelection(undefined);
                    setPage(page + 1);
                  }}
                />
              )}
            <Button
              label="Refresh members"
              variant="link"
              disabled={
                pending || detail.isFetching || members.isFetching || !readRetry
              }
              onPress={() => void review()}
            />
          </View>
        }
      />
      {adding && rights.canAdd && (
        <AddBoardMemberSheet
          email={email}
          onEmailChange={setEmail}
          pending={pending}
          disabled={blocked || !rights.canAdd}
          message={errorMessage}
          review={reviewButton}
          onAdd={(email) => void run({ kind: 'add', email })}
          onClose={() => {
            setAdding(false);
            setEmail('');
          }}
        />
      )}
      {selection &&
        rights.canChange &&
        (selection.kind === 'actions' || selection.kind === 'role') && (
          <BottomSheet
            visible
            title={
              selection.kind === 'role'
                ? 'Change Board role'
                : selection.member.user.displayName
            }
            onDismiss={() => setSelection(undefined)}
            dismissLabel="Dismiss Board member actions"
            showHandle
            respectReducedMotion
          >
            {stale || block ? (
              <Text style={[typography.body, { color: c.warning }]}>
                {block ??
                  'This membership changed. Close and review the latest role.'}
              </Text>
            ) : selection.kind === 'actions' ? (
              <>
                <Button
                  label="Change role"
                  disabled={blocked}
                  onPress={() => setSelection({ ...selection, kind: 'role' })}
                />
                <Button
                  label="Remove member"
                  variant="destructive"
                  disabled={blocked}
                  onPress={() => setSelection({ ...selection, kind: 'remove' })}
                />
              </>
            ) : (
              <>
                <Text style={[typography.body, { color: c.textSecondary }]}>
                  Choose a role for {selection.member.user.displayName} on this
                  Board.
                </Text>
                <SegmentedControl
                  label="Board role"
                  value={selection.role}
                  onChange={(role) =>
                    setSelection({ ...selection, role: role as BoardRole })
                  }
                  options={[BoardRole.OWNER, BoardRole.MEMBER].map((role) => ({
                    value: role,
                    label: role,
                    disabled: blocked,
                  }))}
                />
                <Button
                  label="Review role change"
                  disabled={blocked || selection.role === selection.member.role}
                  onPress={() =>
                    setSelection({ ...selection, kind: 'confirm-role' })
                  }
                />
              </>
            )}
            <Button
              label="Close"
              variant="secondary"
              onPress={() => setSelection(undefined)}
            />
          </BottomSheet>
        )}
      {selection &&
        rights.canChange &&
        (selection.kind === 'confirm-role' || selection.kind === 'remove') && (
          <ConfirmDialog
            visible
            title={
              selection.kind === 'remove'
                ? `Remove ${selection.member.user.displayName}?`
                : `${selection.role === BoardRole.OWNER ? 'Promote' : 'Demote'} ${selection.member.user.displayName} to ${selection.role}?`
            }
            message={
              errorMessage ??
              block ??
              (stale
                ? 'This membership changed. Close and review the latest role.'
                : selection.kind === 'remove'
                  ? `Remove ${selection.member.user.displayName} from this Board and clear their assignments from all its Cards. Their Workspace membership stays in place.`
                  : `Change ${selection.member.user.displayName} from Board ${selection.member.role} to ${selection.role}. ${selection.role === BoardRole.OWNER ? 'They can manage this Board and its members when Workspace policy permits.' : 'They will lose Board owner management rights.'}`)
            }
            confirmLabel={
              selection.kind === 'remove'
                ? 'Remove from Board'
                : 'Confirm role change'
            }
            destructive={
              selection.kind === 'remove' || selection.role === BoardRole.MEMBER
            }
            loading={pending}
            confirmDisabled={blocked || stale || !!block}
            onCancel={() => setSelection(undefined)}
            onConfirm={() =>
              void run(
                selection.kind === 'remove'
                  ? { kind: 'remove', member: selection.member, page }
                  : {
                      kind: 'role',
                      member: selection.member,
                      role: selection.role,
                      page,
                    },
              )
            }
          />
        )}
    </SafeAreaView>
  );
}
