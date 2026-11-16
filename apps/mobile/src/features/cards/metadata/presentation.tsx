import { Text, View } from 'react-native';
import { ApiError } from '../../../infrastructure/api/errors';
import {
  Avatar,
  Button,
  LabelChip,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import type { KanbanAssignee, KanbanLabel } from '../../boards/kanban-api';
import { workspaceErrorMessage } from '../../workspaces/status';
import {
  describeCardDate,
  dueStatus,
  type DateField,
  type DatePreferences,
} from './dates';

export const dateTitles: Record<DateField, string> = {
  startDate: 'Start date',
  dueDate: 'Due date',
};

export function MetadataMessage({
  children,
  error = false,
}: {
  children: string;
  error?: boolean;
}) {
  const c = useTheme();
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[
        typography.supporting,
        { color: error ? c.danger : c.textSecondary },
      ]}
    >
      {children}
    </Text>
  );
}

export function metadataError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.kind === 'session-changed')
      return 'Access changed. Reopen this card to continue.';
    if (error.status === 403)
      return 'You no longer have permission for this change.';
    if (error.status === 404)
      return 'This item is no longer available. Review the updated list.';
    if (error.status === 409 && error.code === 'LABEL_NAME_EXISTS')
      return 'A board label already uses this name.';
    if (
      error.requestStarted &&
      ['timeout', 'network', 'aborted', 'invalid-response'].includes(error.kind)
    )
      return 'Couldn’t confirm the change. Check the refreshed values before trying again.';
  }
  return workspaceErrorMessage(error);
}

export function MetadataLabel({ label }: { label: KanbanLabel }) {
  const c = useTheme();
  return (
    <LabelChip
      compact
      label={label.name}
      colors={{
        foreground: c.text,
        background: `${label.color}24`,
        border: label.color,
      }}
    />
  );
}

export function AssigneeAvatar({
  member,
}: {
  member: Pick<KanbanAssignee, 'name' | 'avatarUrl'>;
}) {
  return (
    <Avatar
      size={32}
      name={member.name}
      source={member.avatarUrl ? { uri: member.avatarUrl } : undefined}
    />
  );
}

export function CardDateValue({
  field,
  value,
  preferences,
  now,
}: {
  field: DateField;
  value: string | null;
  preferences: DatePreferences;
  now?: number;
}) {
  const c = useTheme();
  const date = value ? describeCardDate(value, preferences) : null;
  const status =
    field === 'dueDate' && value
      ? dueStatus(value, preferences.timeZone, now)
      : null;
  const caption =
    status === 'OVERDUE'
      ? 'Overdue'
      : status === 'DUE_TODAY'
        ? 'Due today'
        : status === 'UPCOMING'
          ? 'Upcoming'
          : undefined;
  return (
    <>
      <Text
        selectable
        accessibilityLabel={date?.absolute}
        style={[typography.body, typography.numeric, { color: c.text }]}
      >
        {date?.short ?? 'Not set'}
      </Text>
      {caption && (
        <Text
          style={[
            typography.caption,
            {
              color:
                status === 'OVERDUE'
                  ? c.danger
                  : status === 'DUE_TODAY'
                    ? c.warning
                    : c.textSecondary,
            },
          ]}
        >
          {caption}
        </Text>
      )}
    </>
  );
}

export function DiscardMetadataActions({
  keepEditing,
  discard,
}: {
  keepEditing: () => void;
  discard: () => void;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Button label="Keep editing" variant="secondary" onPress={keepEditing} />
      <Button label="Discard changes" variant="destructive" onPress={discard} />
    </View>
  );
}
