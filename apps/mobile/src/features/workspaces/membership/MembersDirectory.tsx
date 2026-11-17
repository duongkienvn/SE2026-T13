import { useQuery } from '@tanstack/react-query';
import { WorkspaceRole } from '@kanban/shared';
import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  FilterChip,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import { RosterPage, RosterSearch, useRosterPage } from './RosterPage';
import type { WorkspaceCollaborationContext } from './WorkspaceCollaborationScreen';
import { workspaceMembersOptions } from './queries';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { WorkspacePersonAvatar } from './WorkspacePersonAvatar';

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
  const members = useQuery({
    ...workspaceMembersOptions(data, identity, id, roster.page, {
      search: roster.search,
      role,
    }),
    enabled: active && online,
    refetchInterval: 30_000,
  });
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
          </Surface>
        )}
      />
    </>
  );
}
