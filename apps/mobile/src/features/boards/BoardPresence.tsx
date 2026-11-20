import { Text, View } from 'react-native';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import type { BoardRealtimeState } from '../../infrastructure/realtime/rooms';
import { Avatar, spacing, typography, useTheme } from '../../ui';
import { BoardMemberAvatar } from './members/BoardMemberAvatar';
import { useBoardRoster } from './members/useBoardRoster';
import { presenceView } from './presence';

/**
 * Compact "who is in this Board room now" indicator. Explicit members see
 * roster names/avatars; anyone else sees only a count. It never fetches a
 * roster the viewer is not entitled to, and it renders nothing before the
 * room is live or after it is paused, revoked or the session changes.
 */
export function BoardPresence({
  identity,
  boardId,
  room,
  boardReadable,
  explicitMember,
}: {
  identity: SessionIdentity;
  boardId: string;
  room: BoardRealtimeState;
  boardReadable: boolean;
  explicitMember: boolean;
}) {
  const c = useTheme();
  const self = identity.userId.toLowerCase();
  const others =
    room.status === 'live' &&
    room.canRead &&
    boardReadable &&
    room.userIds.some((id) => id.toLowerCase() !== self);
  // No roster traffic until someone else is actually in the room.
  const roster = useBoardRoster(identity, boardId, others && explicitMember);
  const view = presenceView(
    room,
    boardReadable,
    identity.userId,
    explicitMember && !roster.error
      ? new Map(
          [...roster.membersById].map(([id, member]) => [
            id,
            {
              displayName: member.user.displayName,
              isDeleted: member.user.isDeleted,
            },
          ]),
        )
      : null,
  );
  if (view.kind === 'hidden') return null;
  return (
    <View
      testID="board-presence"
      accessible
      accessibilityLabel={view.label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
    >
      {view.kind === 'people' &&
        view.shown.map((person) => {
          const member = roster.membersById.get(person.userId);
          return member ? (
            <BoardMemberAvatar
              key={person.userId}
              member={member}
              identity={identity}
              boardId={boardId}
            />
          ) : (
            <Avatar key={person.userId} name={person.displayName} size={24} />
          );
        })}
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: c.success,
        }}
      />
      <Text style={[typography.caption, { color: c.textSecondary }]}>
        {view.kind === 'people' && view.more && view.shown.length
          ? `+${view.more} viewing`
          : view.kind === 'people' && view.shown.length
            ? 'viewing'
            : `${view.others} viewing`}
      </Text>
    </View>
  );
}
