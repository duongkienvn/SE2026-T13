import { TaskGroup, type TaskCardSummary } from '@kanban/shared';
import { Pressable, Text, View } from 'react-native';
import { Chip, Surface, spacing, typography, useTheme } from '../../ui';
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

export function TaskSections({
  rows,
  preferences,
  disabled,
  opening,
  open,
}: {
  rows: readonly TaskCardSummary[];
  preferences: DatePreferences;
  disabled: boolean;
  opening?: string;
  open: (task: TaskCardSummary) => void;
}) {
  const c = useTheme();
  return taskGroups.map((group) => {
    const tasks = rows.filter((task) => task.group === group);
    if (!tasks.length) return null;
    const color =
      group === TaskGroup.OVERDUE
        ? c.danger
        : group === TaskGroup.NEXT_7_DAYS
          ? c.warning
          : c.primary;
    return (
      <View key={group} style={{ gap: spacing.sm }}>
        <Text accessibilityRole="header" style={[typography.strong, { color }]}>
          {groupLabels[group]} · {tasks.length} loaded
        </Text>
        {tasks.map((task) => (
          <Pressable
            key={task.id}
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
                <Text
                  style={[typography.supporting, { color: c.textSecondary }]}
                >
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
                      <Chip key={label.id} label={label.name} compact />
                    ))}
                  </View>
                )}
                <Text
                  accessibilityLabel={
                    task.dueDate
                      ? 'Due ' +
                        describeCardDate(task.dueDate, preferences).absolute
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
        ))}
      </View>
    );
  });
}
