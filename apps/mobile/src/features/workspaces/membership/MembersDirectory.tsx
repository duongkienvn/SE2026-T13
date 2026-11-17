import { useQuery } from '@tanstack/react-query';
import { WorkspaceRole } from '@kanban/shared';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import {
  Button,
  ConfirmDialog,
  FilterChip,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import { RosterPage, RosterSearch, useRosterPage } from './RosterPage';
import type { WorkspaceCollaborationContext } from './WorkspaceCollaborationScreen';
import { canManageWorkspaceMembers, workspaceMembersOptions } from './queries';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { WorkspacePersonAvatar } from './WorkspacePersonAvatar';
import type { WorkspaceMember } from './decoder';
import { changeWorkspaceMemberRole } from './mutations';
import { useWorkspaceAction } from './useWorkspaceAction';

const roles = [undefined, WorkspaceRole.ADMIN, WorkspaceRole.MEMBER] as const;

export function MembersDirectory({
  context,
}: {
  context: WorkspaceCollaborationContext;
}) {
  const data = useMobileData();
  const c = useTheme();
  const roster = useRosterPage();
  const [role, setRole] = useState<WorkspaceRole>();
  const { identity, id, active, online } = context;
  const [candidate, setCandidate] = useState<WorkspaceMember>();
  const [notice, setNotice] = useState('');
  const action = useWorkspaceAction(context);
  const manager = canManageWorkspaceMembers(context.workspace);
  useEffect(() => {
    if (!manager) setCandidate(undefined);
  }, [manager]);
  const members = useQuery({
    ...workspaceMembersOptions(data, identity, id, roster.page, {
      search: roster.search,
      role,
    }),
    enabled: active && online,
    refetchInterval: 30_000,
  });
  const current = members.data?.data.find(
    ({ userId }) => userId === candidate?.userId,
  );
  const stale = !!candidate && current?.role !== candidate.role;
  const nextRole =
    candidate?.role === WorkspaceRole.ADMIN
      ? WorkspaceRole.MEMBER
      : WorkspaceRole.ADMIN;
  const blocked =
    action.disabled ||
    context.checking ||
    members.isFetching ||
    members.isError;
  return (
    <>
      <RosterSearch roster={roster} />
      <View style={{ gap: spacing.sm, flexDirection: 'row', flexWrap: 'wrap' }}>
        {roles.map((filter) => (
          <FilterChip
            key={filter ?? 'all'}
            label={filter ?? 'All roles'}
            selected={role === filter}
            onPress={() => {
              roster.setPage(1);
              setRole(filter);
            }}
          />
        ))}
      </View>
      {!!notice && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: c.text }]}
        >
          {notice}
        </Text>
      )}
      {action.message && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: c.danger }]}
        >
          {action.message}
        </Text>
      )}
      {action.mustReview && (
        <Button
          label="Check latest members"
          disabled={!online || members.isFetching}
          onPress={async () => {
            if ((await members.refetch()).isSuccess) {
              action.reviewed();
              setCandidate(undefined);
            }
          }}
        />
      )}
      <RosterPage
        roster={roster}
        query={members}
        itemLabel="Workspace member"
        empty="No members match this search."
        render={(member) => (
          <Surface key={member.userId}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
              }}
            >
              <WorkspacePersonAvatar
                context={context}
                name={member.displayName}
                userId={member.userId}
                avatarUrl={member.avatarUrl}
                revision={member.avatarRevision}
              />
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text style={[typography.strong, { color: c.text }]}>
                  {member.displayName}
                </Text>
                <Text
                  style={[typography.supporting, { color: c.textSecondary }]}
                >
                  Workspace {member.role}
                  {member.userId === identity.userId ? ' · You' : ''}
                </Text>
                <Text
                  style={[typography.supporting, { color: c.textSecondary }]}
                >
                  Joined {new Date(member.joinedAt).toLocaleDateString()}
                </Text>
              </View>
            </View>
            {manager && member.userId !== identity.userId && (
              <Button
                label={`Change role for ${member.displayName}`}
                variant="link"
                disabled={blocked}
                onPress={() => {
                  action.clearError();
                  setNotice('');
                  setCandidate(member);
                }}
              />
            )}
          </Surface>
        )}
      />
      {candidate && manager && (
        <ConfirmDialog
          visible
          title={
            nextRole === WorkspaceRole.ADMIN
              ? 'Promote to Workspace ADMIN?'
              : 'Change to Workspace MEMBER?'
          }
          message={
            action.message ??
            (stale
              ? 'This membership changed. Close and review the latest role.'
              : `Change ${candidate.displayName} to Workspace ${nextRole}? Their Board roles stay separate.`)
          }
          confirmLabel="Change role"
          onCancel={() => setCandidate(undefined)}
          onConfirm={() =>
            void action.run(
              (signal) =>
                changeWorkspaceMemberRole(
                  data,
                  identity,
                  id,
                  candidate.userId,
                  nextRole,
                  signal,
                ),
              () => {
                setNotice('Workspace role updated.');
                setCandidate(undefined);
              },
            )
          }
          loading={action.pending}
          confirmDisabled={blocked || stale}
        />
      )}
    </>
  );
}
