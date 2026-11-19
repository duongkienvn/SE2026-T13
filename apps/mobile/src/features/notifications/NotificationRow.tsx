import type { NotificationResponse } from '@kanban/shared';
import {
  Image,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import users from '../../../assets/workspace-icons/users.png';
import boards from '../../../assets/navigation/boards.png';
import tasks from '../../../assets/navigation/tasks.png';
import { Button, radius, spacing, typography, useTheme } from '../../ui';
import type { DatePreferences } from '../cards/metadata/dates';
import { notificationDestination } from './decoder';
import { notificationTime } from './grouping';
export const notificationLabels = {
  CARD_ASSIGNED: 'Assigned to a card',
  COMMENT_MENTIONED: 'You were mentioned',
  WORKSPACE_INVITED: 'Workspace invitation',
  BOARD_INVITED: 'Board invitation',
  MEMBERSHIP_CHANGED: 'Membership changed',
  DUE_REMINDER: 'Deadline approaching',
} as const;
const images = {
  CARD_ASSIGNED: tasks,
  WORKSPACE_INVITED: users,
  BOARD_INVITED: boards,
};
export function NotificationRow({
  item,
  preferences,
  disabled,
  pending = false,
  opening = false,
  onOpen,
  onRead,
}: {
  item: NotificationResponse;
  preferences: DatePreferences;
  disabled: boolean;
  pending?: boolean;
  opening?: boolean;
  onOpen: (item: NotificationResponse) => void;
  onRead: (item: NotificationResponse) => void;
}) {
  const c = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const narrow = width / Math.max(fontScale, 1) < 360;
  const unavailable = item.isUnavailable;
  const label = unavailable
    ? 'No longer available'
    : notificationLabels[item.kind];
  const actor = unavailable ? null : item.actor;
  const scope =
    unavailable || !item.context
      ? ''
      : item.context.cardId
        ? 'Card update'
        : item.context.boardId
          ? 'Board update'
          : item.context.workspaceId
            ? 'Workspace update'
            : '';
  const time = notificationTime(item.createdAt, preferences);
  const unread = item.readAt === null;
  const canOpen = !!notificationDestination(item);
  const icon =
    !unavailable && item.kind in images
      ? images[item.kind as keyof typeof images]
      : undefined;
  const body = (
    <View style={{ flexDirection: 'row', gap: spacing.sm, flex: 1 }}>
      <View
        accessible={false}
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.control,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.surfaceSoft,
        }}
      >
        {icon ? (
          <Image
            source={icon}
            style={{ width: 22, height: 22, tintColor: c.primary }}
          />
        ) : (
          <Text
            style={[
              typography.section,
              { color: unavailable ? c.textMuted : c.primary },
            ]}
          >
            {unavailable
              ? '–'
              : item.kind === 'COMMENT_MENTIONED'
                ? '@'
                : item.kind === 'DUE_REMINDER'
                  ? '◷'
                  : '↔'}
          </Text>
        )}
      </View>
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text style={[typography.strong, { color: c.text }]}>{label}</Text>
        {actor && (
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            {actor.isDeleted ? 'Deleted user' : actor.displayName}
          </Text>
        )}
        <Text style={[typography.body, { color: c.text }]}>{item.summary}</Text>
        {!!scope && (
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            {scope}
          </Text>
        )}
        <Text
          accessibilityLabel={`${time.absolute}. Server timestamp ${item.createdAt}`}
          style={[typography.supporting, { color: c.textSecondary }]}
        >
          {time.short}
        </Text>
        {!canOpen && !unavailable && (
          <Text style={[typography.supporting, { color: c.textMuted }]}>
            No page to open
          </Text>
        )}
      </View>
      {unread && (
        <View
          accessible={false}
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            marginTop: spacing.sm,
            backgroundColor: c.primary,
          }}
        />
      )}
    </View>
  );
  return (
    <View
      style={{
        gap: spacing.xs,
        padding: spacing.md,
        borderRadius: radius.control,
        backgroundColor: unread ? c.primaryTint : c.surface,
        borderBottomWidth: 1,
        borderColor: c.border,
      }}
    >
      {canOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open notification: ${unread ? 'Unread. ' : ''}${label}. ${actor ? (actor.isDeleted ? 'Deleted user' : actor.displayName) + '. ' : ''}${item.summary}. ${scope}. ${time.absolute}`}
          accessibilityState={{ disabled, busy: opening }}
          disabled={disabled}
          onPress={() => onOpen(item)}
          style={({ pressed }) => ({
            minHeight: 48,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}
      {opening && (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: c.textSecondary }}
        >
          Opening notification…
        </Text>
      )}
      {unread && (
        <View style={{ alignSelf: narrow ? 'stretch' : 'flex-end' }}>
          <Button
            label="Mark as read"
            accessibilityLabel={'Mark as read: ' + item.summary}
            variant="link"
            disabled={disabled}
            loading={pending}
            onPress={() => onRead(item)}
          />
        </View>
      )}
    </View>
  );
}
