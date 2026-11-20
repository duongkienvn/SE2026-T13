import type { NotificationPreferences } from '@kanban/shared';
import { Image, Text, View } from 'react-native';
import tasks from '../../../../assets/navigation/tasks.png';
import boards from '../../../../assets/navigation/boards.png';
import users from '../../../../assets/workspace-icons/users.png';
import {
  PreferenceSwitch,
  SectionHeader,
  Surface,
  radius,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import { emailKeys, inAppKeys } from './model';

const rows = {
  cardAssigned: {
    label: 'Card assignments',
    description: 'When someone assigns a Card to you',
    image: tasks,
  },
  commentMentioned: {
    label: 'Mentions',
    description: 'When you are @mentioned in a comment',
    glyph: '@',
  },
  dueReminder: {
    label: 'Due date reminders',
    description: 'Reminders follow the existing server policy',
    glyph: '◷',
  },
  workspaceInvited: {
    label: 'Workspace invitations',
    description: 'When you receive a Workspace invitation',
    image: users,
  },
  membershipChanged: {
    label: 'Membership changes',
    description: 'Updates about membership and access changes',
    image: users,
  },
  boardInvited: {
    label: 'Board invitations',
    description: 'Not sent yet — boards add members directly today',
    image: boards,
  },
};
function PreferenceIcon({ name }: { name: keyof typeof rows }) {
  const c = useTheme(),
    row = rows[name];
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 36,
        height: 36,
        borderRadius: radius.control,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: c.primaryTint,
      }}
    >
      {'image' in row ? (
        <Image
          source={row.image}
          style={{ width: 22, height: 22, tintColor: c.primary }}
        />
      ) : (
        <Text style={[typography.section, { color: c.primary }]}>
          {row.glyph}
        </Text>
      )}
    </View>
  );
}
export function PreferenceSections({
  draft,
  disabled,
  emailEnabled,
  onEdit,
}: {
  draft: NotificationPreferences;
  disabled: boolean;
  emailEnabled: boolean;
  onEdit: (channel: 'inApp' | 'email', key: string, value: boolean) => void;
}) {
  const c = useTheme();
  return (
    <>
      <Surface>
        <SectionHeader title="In-app notifications" />
        <Text style={[typography.body, { color: c.textSecondary }]}>
          Choose future updates in your Kanvexa Inbox. Existing notifications
          and read counts stay unchanged.
        </Text>
        {inAppKeys.map((key) => (
          <PreferenceSwitch
            key={key}
            label={rows[key].label}
            description={rows[key].description}
            accessibilityLabel={'In-app: ' + rows[key].label}
            icon={<PreferenceIcon name={key} />}
            value={draft.inApp[key]}
            disabled={disabled}
            onValueChange={(value) => onEdit('inApp', key, value)}
          />
        ))}
      </Surface>
      <Surface>
        <SectionHeader title="Email notifications" />
        <Text style={[typography.body, { color: c.textSecondary }]}>
          {emailEnabled
            ? 'Optional task emails. Delivery is best-effort when the server dispatcher is enabled.'
            : 'Task email delivery is not enabled for this Kanvexa environment'}
        </Text>
        {emailKeys.map((key) => (
          <PreferenceSwitch
            key={key}
            label={rows[key].label}
            description={'Optional task email · ' + rows[key].description}
            accessibilityLabel={'Email: ' + rows[key].label}
            accessibilityHint={
              emailEnabled
                ? 'Optional task email. Delivery is best-effort.'
                : 'Read-only. Task email delivery is not enabled for this Kanvexa environment.'
            }
            icon={<PreferenceIcon name={key} />}
            value={draft.email[key]}
            disabled={disabled || !emailEnabled}
            onValueChange={(value) => onEdit('email', key, value)}
          />
        ))}
        <View style={{ gap: spacing.xs, paddingVertical: spacing.md }}>
          <Text style={[typography.strong, { color: c.text }]}>
            Security &amp; account
          </Text>
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            Password, sign-in and verification emails cannot be disabled.
          </Text>
          <Text style={[typography.strong, { color: c.primaryPressed }]}>
            Always on
          </Text>
        </View>
      </Surface>
    </>
  );
}
