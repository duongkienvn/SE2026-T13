import type { NotificationResponse } from '@kanban/shared';
import type { ReactElement } from 'react';
import { Text, type RefreshControlProps } from 'react-native';
import { spacing, typography, useTheme } from '../../ui';
import { VirtualSections } from '../../ui/sections';
import type { DatePreferences } from '../cards/metadata/dates';
import { groupNotifications } from './grouping';
import { NotificationRow } from './NotificationRow';

/** Day-grouped notifications in a virtualized list (P01); grouping is unchanged. */
export function InboxSections({
  rows,
  preferences,
  disabled,
  pending,
  opening,
  now,
  onOpen,
  onRead,
  header,
  footer,
  refreshControl,
}: {
  rows: readonly NotificationResponse[];
  preferences: DatePreferences;
  disabled: boolean;
  pending?: string | null;
  opening?: string;
  now: Date;
  onOpen: (item: NotificationResponse) => void;
  onRead: (item: NotificationResponse) => void;
  header: ReactElement;
  footer: ReactElement;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const c = useTheme();
  const sections = groupNotifications(rows, preferences, now).map((group) => ({
    key: group.key,
    data: group.items,
    header: (
      <Text
        accessibilityRole="header"
        style={[typography.strong, { color: c.text }]}
      >
        {group.label}
      </Text>
    ),
  }));
  return (
    <VirtualSections
      testID="inbox-scroll"
      automaticallyAdjustKeyboardInsets
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={(item) => (
        <NotificationRow
          item={item}
          preferences={preferences}
          disabled={disabled}
          pending={pending === item.id || pending === 'all'}
          opening={opening === item.id}
          onOpen={onOpen}
          onRead={onRead}
        />
      )}
      header={header}
      footer={footer}
      refreshControl={refreshControl}
      contentContainerStyle={{ padding: spacing.xl }}
    />
  );
}
