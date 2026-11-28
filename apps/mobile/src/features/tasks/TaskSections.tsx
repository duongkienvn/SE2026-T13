import { TaskGroup, type TaskCardSummary } from '@kanban/shared';
import type { ReactElement } from 'react';
import { Pressable, Text, View, type RefreshControlProps } from 'react-native';
import { Chip, Surface, spacing, typography, useTheme } from '../../ui';
import { VirtualSections } from '../../ui/sections';
import {
  describeCardDate,
  type DatePreferences,
} from '../cards/metadata/dates';
import { taskGroups } from './decoder';

export const groupLabels = {
  ALL: 'All',
  OVERDUE: 'Overdue',
  NEXT_7_DAYS: 'Next 7 days',
  LATER: 'Later',
  NO_DUE_DATE: 'No due date',
} as const;

function TaskRow({
  task,
  preferences,
  disabled,
  opening,
  open,
}: {
  task: TaskCardSummary;
  preferences: DatePreferences;
  disabled: boolean;
  opening?: string;
  open: (task: TaskCardSummary) => void;
}) {
  const c = useTheme();
  const group = task.group;
  const color = groupColor(group, c);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${task.title}, ${task.workspaceName}, ${task.boardName}, ${groupLabels[group]}`}
      accessibilityState={{ disabled, busy: opening === task.id }}
      disabled={disabled}
      onPress={() => open(task)}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        style={{
          borderLeftWidth: 3,
          borderLeftColor: color,
          borderRadius: 12,
        }}
      >
        <Surface>
          <Text style={[typography.strong, { color: c.text }]}>
            {task.title}
          </Text>
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            {task.workspaceName} · {task.boardName}
          </Text>
          {!!task.labels.length && (
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: spacing.xs,
              }}
            >
              {task.labels.map((label) => (
                <Chip
                  key={label.id}
                  label={label.name}
                  compact
                  colors={{
                    foreground: c.text,
                    background: c.surfaceSoft,
                    border: label.color,
                  }}
                />
              ))}
            </View>
          )}
          <Text
            accessibilityLabel={
              task.dueDate
                ? 'Due ' + describeCardDate(task.dueDate, preferences).absolute
                : 'No due date'
            }
            style={[typography.supporting, { color }]}
          >
            {task.dueDate
              ? 'Due ' + describeCardDate(task.dueDate, preferences).short
              : 'No due date'}
          </Text>
        </Surface>
      </View>
    </Pressable>
  );
}

function groupColor(group: TaskGroup, c: ReturnType<typeof useTheme>) {
  return group === TaskGroup.OVERDUE
    ? c.danger
    : group === TaskGroup.NEXT_7_DAYS
      ? c.warning
      : c.primary;
}

/**
 * Server-grouped rows in a virtualized list (P01). Group order and per-group
 * loaded counts are unchanged; only rows near the viewport stay mounted.
 */
export function TaskSections({
  rows,
  preferences,
  disabled,
  opening,
  open,
  header,
  footer,
  refreshControl,
}: {
  rows: readonly TaskCardSummary[];
  preferences: DatePreferences;
  disabled: boolean;
  opening?: string;
  open: (task: TaskCardSummary) => void;
  header: ReactElement;
  footer: ReactElement;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const c = useTheme();
  const sections = taskGroups.flatMap((group) => {
    const tasks = rows.filter((task) => task.group === group);
    return tasks.length
      ? [
          {
            key: group,
            data: tasks,
            header: (
              <Text
                accessibilityRole="header"
                style={[typography.strong, { color: groupColor(group, c) }]}
              >
                {groupLabels[group]} · {tasks.length} loaded
              </Text>
            ),
          },
        ]
      : [];
  });
  return (
    <VirtualSections
      testID="my-tasks-scroll"
      sections={sections}
      keyExtractor={(task) => task.id}
      renderItem={(task) => (
        <TaskRow
          task={task}
          preferences={preferences}
          disabled={disabled}
          opening={opening}
          open={open}
        />
      )}
      header={header}
      footer={footer}
      refreshControl={refreshControl}
      contentContainerStyle={{ padding: spacing.xl }}
    />
  );
}
