import type { CardDueStatus, CardPreviewSummary } from '@kanban/shared';
import { memo, useCallback, useMemo, useState, type ReactElement } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Button,
  EmptyState,
  ProgressBar,
  Skeleton,
  radius,
  sizes,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import type { DatePreferences } from '../../cards/metadata/dates';
import {
  AssigneeAvatar,
  CardDateValue,
  MetadataLabel,
} from '../../cards/metadata/presentation';
import { resolveAssignees } from '../../cards/metadata/queries';
import { useScrollRestore } from '../BoardKanban';
import { useDueReconciler } from '../useDueReconciler';
import type {
  KanbanAssignee,
  KanbanCard,
  KanbanColumn,
  KanbanLabel,
} from '../kanban-api';

const TableRow = memo(function TableRow({
  card,
  column,
  summary,
  labels,
  members,
  preferences,
  now,
  onOpen,
  onActions,
  actionsDisabled,
}: {
  card: KanbanCard;
  column?: string;
  summary?: CardPreviewSummary;
  labels: ReadonlyMap<string, KanbanLabel>;
  members: readonly KanbanAssignee[];
  preferences?: DatePreferences;
  now: number;
  onOpen: (card: KanbanCard) => void;
  onActions?: (card: KanbanCard) => void;
  actionsDisabled?: boolean;
}) {
  const c = useTheme();
  const [focused, setFocused] = useState(false);
  const people = resolveAssignees(card.assignees, members);
  const knownPeople = people.filter((person) =>
    members.some((member) => member.id === person.id),
  );
  const unknownLabels = summary?.labelIds.filter(
    (id) => !labels.has(id),
  ).length;
  const checklist = summary?.checklist;
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: c.surface, borderColor: c.border },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open card: ${card.title}`}
        accessibilityHint="Opens Card details. Back returns to this table."
        onPress={() => onOpen(card)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed }) => [
          styles.open,
          {
            backgroundColor: pressed ? c.surfaceSoft : c.surface,
            borderColor: focused ? c.focus : 'transparent',
          },
        ]}
      >
        <Text
          accessibilityRole="header"
          style={[typography.section, { color: c.text }]}
        >
          {card.title}
        </Text>
        <Text style={[typography.supporting, { color: c.textSecondary }]}>
          {`Column: ${column ?? 'Details unavailable'}`}
        </Text>
        <Text style={[typography.strong, { color: c.primaryPressed }]}>
          Open card
        </Text>
      </Pressable>
      <View style={styles.metadata}>
        <Text style={[typography.caption, { color: c.textSecondary }]}>
          Labels
        </Text>
        <View style={styles.wrap}>
          {summary?.labelIds.map((id) => {
            const label = labels.get(id);
            return label ? <MetadataLabel key={id} label={label} /> : null;
          })}
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            {!summary
              ? 'Labels unavailable'
              : unknownLabels
                ? `${unknownLabels} unresolved ${unknownLabels === 1 ? 'label' : 'labels'}`
                : summary.labelIds.length === 0
                  ? 'No labels'
                  : ''}
          </Text>
        </View>
        <Text style={[typography.caption, { color: c.textSecondary }]}>
          Assignees
        </Text>
        <View style={styles.wrap}>
          {knownPeople.slice(0, 3).map((person) => (
            <AssigneeAvatar key={person.id} member={person} />
          ))}
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            {people.length === 0
              ? 'Unassigned'
              : knownPeople.length === people.length
                ? knownPeople.map((person) => person.name).join(', ')
                : `${people.length} assigned`}
          </Text>
        </View>
        <Text style={[typography.caption, { color: c.textSecondary }]}>
          Due date
        </Text>
        {preferences ? (
          <CardDateValue
            field="dueDate"
            value={card.dueDate}
            preferences={preferences}
            now={now}
          />
        ) : (
          <Text
            selectable
            style={[typography.supporting, { color: c.textSecondary }]}
          >
            {card.dueDate
              ? `${card.dueDate} · UTC (date preferences unavailable)`
              : 'Not set'}
          </Text>
        )}
        <Text style={[typography.caption, { color: c.textSecondary }]}>
          Checklist
        </Text>
        <Text
          style={[
            typography.supporting,
            typography.numeric,
            { color: c.textSecondary },
          ]}
        >
          {!checklist
            ? 'Checklist unavailable'
            : checklist.totalItems === 0
              ? 'No checklist items'
              : `${checklist.checkedItems}/${checklist.totalItems} checklist items`}
        </Text>
        {!!checklist?.totalItems && (
          <ProgressBar
            label={`${checklist.checkedItems}/${checklist.totalItems} checklist items`}
            value={(100 * checklist.checkedItems) / checklist.totalItems}
          />
        )}
        {onActions && !card.isArchived && (
          <Button
            label={`Card actions for ${card.title}`}
            variant="icon"
            icon={
              <Text style={[typography.section, { color: c.text }]}>⋯</Text>
            }
            disabled={actionsDisabled}
            onPress={() => onActions(card)}
          />
        )}
      </View>
    </View>
  );
});

export function BoardTable({
  cards,
  columns,
  previews,
  labels,
  members,
  preferences,
  ready,
  complete,
  loading,
  scroll,
  header,
  footer,
  onOpen,
  onActions,
  actionsDisabled,
  active,
  dueStatus,
  fetchedAt,
  onDueBoundary,
}: {
  cards: readonly KanbanCard[];
  columns: readonly KanbanColumn[];
  previews: ReadonlyMap<string, CardPreviewSummary>;
  labels: readonly KanbanLabel[];
  members: readonly KanbanAssignee[];
  preferences?: DatePreferences;
  ready: boolean;
  complete: boolean;
  loading: boolean;
  scroll: { y: number };
  header: ReactElement;
  footer: ReactElement;
  onOpen: (card: KanbanCard) => void;
  onActions?: (card: KanbanCard) => void;
  actionsDisabled?: boolean;
  active: boolean;
  dueStatus?: CardDueStatus;
  fetchedAt?: number;
  onDueBoundary?: () => void;
}) {
  const now = useDueReconciler({
    cards,
    dueStatus,
    timeZone: preferences?.timeZone,
    fetchedAt,
    active,
    onDueBoundary,
  });
  const labelMap = useMemo(
    () => new Map(labels.map((label) => [label.id, label])),
    [labels],
  );
  const columnMap = useMemo(
    () => new Map(columns.map((column) => [column.id, column.name])),
    [columns],
  );
  const save = useCallback(
    (y: number) => {
      scroll.y = y;
    },
    [scroll],
  );
  const position = useScrollRestore<KanbanCard>(
    scroll.y,
    complete && !loading,
    save,
  );
  return (
    <FlatList
      testID="board-table"
      ref={position.list}
      style={{ flex: 1 }}
      data={cards}
      keyExtractor={(card) => card.id}
      initialNumToRender={5}
      maxToRenderPerBatch={5}
      windowSize={5}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      scrollEventThrottle={32}
      onLayout={(event) =>
        position.setViewport(event.nativeEvent.layout.height)
      }
      onContentSizeChange={(_, height) => position.setContent(height)}
      onScrollBeginDrag={position.userScroll}
      onScroll={(event) => {
        if (position.restored()) save(event.nativeEvent.contentOffset.y);
      }}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={
        ready && complete ? (
          <EmptyState
            title="No cards to display"
            description="Try clearing filters or switch to Board to add a card where permitted."
          />
        ) : !ready && loading ? (
          <View style={styles.placeholder}>
            <Skeleton height={240} label="Loading table cards" />
          </View>
        ) : undefined
      }
      renderItem={({ item }) => (
        <TableRow
          card={item}
          column={columnMap.get(item.columnId)}
          summary={previews.get(item.id)}
          labels={labelMap}
          members={members}
          preferences={preferences}
          now={now}
          onOpen={onOpen}
          onActions={onActions}
          actionsDisabled={actionsDisabled}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  open: {
    padding: spacing.md,
    gap: spacing.sm,
    minHeight: sizes.touch,
    borderWidth: 2,
    borderRadius: radius.card,
  },
  metadata: { padding: spacing.md, paddingTop: 0, gap: spacing.sm },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  placeholder: { padding: spacing.lg },
});
