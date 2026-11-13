import { WorkspaceType, WorkspaceRole } from '@kanban/shared';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import accountIcon from '../../../assets/navigation/account.png';
import {
  BottomSheet,
  Button,
  radius,
  sizes,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import type { WorkspaceSummary } from './decoder';

export function workspaceMetadata(
  workspace: WorkspaceSummary,
  members?: number,
) {
  const type =
    workspace.type === WorkspaceType.PERSONAL
      ? 'Personal Workspace'
      : 'Team Workspace';
  const role = workspace.role === WorkspaceRole.ADMIN ? 'Admin' : 'Member';
  const count =
    members === undefined
      ? ''
      : ` · ${members} ${members === 1 ? 'member' : 'members'}`;
  return `${type} · ${role}${count}`;
}

function WorkspaceIcon({ type }: { type: WorkspaceSummary['type'] }) {
  const c = useTheme();
  const personal = type === WorkspaceType.PERSONAL;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.icon, { backgroundColor: c.surfaceSoft }]}
    >
      {personal ? (
        <Image
          source={accountIcon}
          style={[styles.person, { tintColor: c.focus }]}
        />
      ) : (
        <View style={styles.team}>
          <Image
            source={accountIcon}
            style={[styles.person, { tintColor: c.focus }]}
          />
          <Image
            source={accountIcon}
            style={[styles.teammate, { tintColor: c.textSecondary }]}
          />
        </View>
      )}
    </View>
  );
}

function WorkspaceRow({
  workspace,
  members,
  onPress,
  trigger = false,
  selected = false,
  expanded = false,
}: {
  workspace: WorkspaceSummary;
  members?: number;
  onPress: () => void;
  trigger?: boolean;
  selected?: boolean;
  expanded?: boolean;
}) {
  const c = useTheme();
  const meta = workspaceMetadata(workspace, members);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${trigger ? 'Switch workspace. Current workspace: ' : 'Select '}${workspace.name}, ${meta}`}
      accessibilityState={trigger ? { expanded } : { selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: trigger || selected ? c.primaryTint : c.surface,
          borderColor: selected
            ? c.primaryBorder
            : trigger
              ? c.primaryBorder
              : 'transparent',
          opacity: pressed ? 0.78 : 1,
        },
      ]}
    >
      <WorkspaceIcon type={workspace.type} />
      <View style={styles.info}>
        <Text style={[typography.strong, { color: c.text }]}>
          {workspace.name}
        </Text>
        <Text style={[typography.supporting, { color: c.textSecondary }]}>
          {meta}
        </Text>
      </View>
      {trigger ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[styles.chevron, { borderColor: c.focus }]}
        />
      ) : selected ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[styles.check, { backgroundColor: c.primary }]}
        >
          <Text
            allowFontScaling={false}
            style={[typography.caption, { color: c.onPrimary }]}
          >
            ✓
          </Text>
        </View>
      ) : (
        <View style={{ width: 24 }} />
      )}
    </Pressable>
  );
}

export function WorkspaceSelector({
  selected,
  workspaces,
  memberCount,
  open,
  onOpen,
  onDismiss,
  onSelect,
}: {
  selected: WorkspaceSummary;
  workspaces: readonly WorkspaceSummary[];
  memberCount?: number;
  open: boolean;
  onOpen: () => void;
  onDismiss: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <WorkspaceRow
        workspace={selected}
        members={memberCount}
        onPress={onOpen}
        trigger
        expanded={open}
      />
      {open && (
        <BottomSheet
          visible
          title="Switch workspace"
          dismissLabel="Dismiss workspace picker"
          onDismiss={onDismiss}
        >
          <View style={styles.options}>
            {workspaces.map((workspace) => (
              <WorkspaceRow
                key={workspace.id}
                workspace={workspace}
                selected={workspace.id === selected.id}
                members={workspace.id === selected.id ? memberCount : undefined}
                onPress={() => onSelect(workspace.id)}
              />
            ))}
          </View>
          <Button label="Close" variant="link" onPress={onDismiss} />
        </BottomSheet>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.touch + spacing.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius.card,
  },
  info: { flex: 1, minWidth: 0, gap: spacing.xs },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  person: { width: 22, height: 22 },
  team: { width: 28, height: 24, flexDirection: 'row', alignItems: 'flex-end' },
  teammate: { width: 16, height: 16, marginLeft: -9, marginBottom: 2 },
  options: { gap: spacing.xs },
  check: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    width: 10,
    height: 10,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    transform: [{ rotate: '45deg' }],
    marginRight: spacing.xs,
  },
});
