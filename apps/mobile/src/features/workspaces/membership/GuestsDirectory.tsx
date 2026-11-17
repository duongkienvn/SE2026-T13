import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import {
  StatusChip,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import { RosterPage, RosterSearch, useRosterPage } from './RosterPage';
import type { WorkspaceCollaborationContext } from './WorkspaceCollaborationScreen';
import { WorkspacePersonAvatar } from './WorkspacePersonAvatar';
import { workspaceGuestsOptions } from './queries';

export function GuestsDirectory({
  context,
}: {
  context: WorkspaceCollaborationContext;
}) {
  const data = useMobileData();
  const c = useTheme();
  const roster = useRosterPage();
  const { identity, id, active, online } = context;
  const guests = useQuery({
    ...workspaceGuestsOptions(data, identity, id, roster.page, roster.search),
    enabled: active && online,
    refetchInterval: 30_000,
  });
  return (
    <>
      <Text style={[typography.body, { color: c.textSecondary }]}>
        You can see guests only on Boards whose member rosters you can access.
      </Text>
      <RosterSearch roster={roster} />
      {online && !context.checking && (
        <RosterPage
          roster={roster}
          query={guests}
          itemLabel="visible guest"
          empty={
            roster.search
              ? 'No visible guests match this search.'
              : 'No guests are visible on the Board rosters you can access.'
          }
          render={(guest) => (
            <Surface key={guest.user.id}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                }}
              >
                <WorkspacePersonAvatar
                  context={context}
                  name={guest.user.displayName}
                  userId={guest.user.id}
                  avatarUrl={guest.user.avatarUrl}
                />
                <View style={{ flex: 1, gap: spacing.xs }}>
                  <Text style={[typography.strong, { color: c.text }]}>
                    {guest.user.displayName}
                  </Text>
                  <Text
                    style={[typography.supporting, { color: c.textSecondary }]}
                  >
                    {guest.visibleBoardCount} visible Board
                    {guest.visibleBoardCount === 1 ? '' : 's'}
                  </Text>
                </View>
              </View>
              {guest.boards.map((board) => (
                <View key={board.boardId} style={{ gap: spacing.xs }}>
                  <Text style={[typography.body, { color: c.text }]}>
                    {board.name}
                  </Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      gap: spacing.xs,
                    }}
                  >
                    <StatusChip label={`Board ${board.role}`} />
                    {board.isArchived && (
                      <StatusChip label="Archived" tone="info" />
                    )}
                  </View>
                </View>
              ))}
            </Surface>
          )}
        />
      )}
    </>
  );
}
