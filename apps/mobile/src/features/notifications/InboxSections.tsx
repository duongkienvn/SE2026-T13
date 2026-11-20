import type { NotificationResponse } from '@kanban/shared';
import { Text, View } from 'react-native';
import { spacing, typography, useTheme } from '../../ui';
import type { DatePreferences } from '../cards/metadata/dates';
import { groupNotifications } from './grouping';
import { NotificationRow } from './NotificationRow';
export function InboxSections({
  rows,
  preferences,
  disabled,
  pending,
  opening,
  now,
  onOpen,
  onRead,
}: {
  rows: readonly NotificationResponse[];
  preferences: DatePreferences;
  disabled: boolean;
  pending?: string | null;
  opening?: string;
  now: Date;
  onOpen: (item: NotificationResponse) => void;
  onRead: (item: NotificationResponse) => void;
}) {
  const c = useTheme();
  return groupNotifications(rows, preferences, now).map((group) => (
    <View key={group.key} style={{ gap: spacing.sm }}>
      <Text
        accessibilityRole="header"
        style={[typography.strong, { color: c.text }]}
      >
        {group.label}
      </Text>
      {group.items.map((item) => (
        <NotificationRow
          key={item.id}
          item={item}
          preferences={preferences}
          disabled={disabled}
          pending={pending === item.id || pending === 'all'}
          opening={opening === item.id}
          onOpen={onOpen}
          onRead={onRead}
        />
      ))}
    </View>
  ));
}
