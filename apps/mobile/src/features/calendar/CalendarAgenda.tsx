import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CardPreviewSummary } from '@kanban/shared';
import type {
  KanbanAssignee,
  KanbanCard,
  KanbanLabel,
} from '../boards/kanban-api';
import { CardDateValue, MetadataLabel } from '../cards/metadata/presentation';
import {
  describeCardDate,
  dueStatus,
  type DatePreferences,
} from '../cards/metadata/dates';
import { radius, spacing, typography, useTheme } from '../../ui';

export const CalendarAgendaCard = memo(function CalendarAgendaCard({
  card,
  boardName,
  column,
  preferences,
  now,
  summary,
  labels,
  members,
  onOpen,
}: {
  card: KanbanCard;
  boardName: string;
  column?: string;
  preferences: DatePreferences;
  now: number;
  summary?: CardPreviewSummary;
  labels: readonly KanbanLabel[];
  members: readonly KanbanAssignee[];
  onOpen: (card: KanbanCard) => void;
}) {
  const c = useTheme();
  const [focused, setFocused] = useState(false);
  const people = members.filter((member) =>
    card.assignees.some(({ userId }) => userId === member.id),
  );
  const unresolvedPeople = card.assignees.length - people.length;
  const unresolvedLabels = (summary?.labelIds ?? []).filter(
    (id) => !labels.some((label) => label.id === id),
  ).length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open card: ${card.title}`}
      accessibilityValue={{
        text: [
          boardName,
          column,
          card.dueDate
            ? `Due ${describeCardDate(card.dueDate, preferences).absolute}, ${dueStatus(card.dueDate, preferences.timeZone, now).toLowerCase().replaceAll('_', ' ')}`
            : '',
          ...labels
            .filter((label) => summary?.labelIds.includes(label.id))
            .map(({ name }) => name),
          ...people.map(({ name }) => name),
          unresolvedPeople
            ? `${unresolvedPeople} assigned, details unavailable`
            : '',
          unresolvedLabels ? `${unresolvedLabels} labels unavailable` : '',
        ]
          .filter(Boolean)
          .join(', '),
      }}
      accessibilityHint="Opens Card details. Back returns to this calendar."
      onPress={() => onOpen(card)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? c.primaryTint : c.surface,
          borderColor: focused ? c.focus : c.border,
        },
      ]}
    >
      <Text style={[typography.strong, { color: c.text }]}>{card.title}</Text>
      <Text style={[typography.supporting, { color: c.textSecondary }]}>
        {boardName} · {column ?? 'Column details unavailable'}
      </Text>
      <CardDateValue
        field="dueDate"
        value={card.dueDate}
        preferences={preferences}
        now={now}
      />
      {!!summary && (
        <View style={styles.wrap}>
          {labels
            .filter((label) => summary.labelIds.includes(label.id))
            .map((label) => (
              <MetadataLabel key={label.id} label={label} />
            ))}
        </View>
      )}
      {unresolvedLabels > 0 && (
        <Text style={[typography.supporting, { color: c.textSecondary }]}>
          Label details unavailable
        </Text>
      )}
      {unresolvedPeople > 0 && (
        <Text style={[typography.supporting, { color: c.textSecondary }]}>
          Assignee details unavailable
        </Text>
      )}
      {people.length > 0 && (
        <Text style={[typography.supporting, { color: c.textSecondary }]}>
          Assigned to {people.map(({ name }) => name).join(', ')}
        </Text>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    gap: spacing.xs,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.card,
    borderCurve: 'continuous',
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
