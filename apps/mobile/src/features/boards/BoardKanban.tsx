import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import type { CardPreviewSummary } from '@kanban/shared';
import {
  AvatarStack,
  Button,
  CardPreview,
  DueChip,
  LabelChip,
  ProgressBar,
  radius,
  sizes,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import type {
  KanbanAssignee,
  KanbanCard,
  KanbanColumn,
  KanbanLabel,
} from './kanban-api';
import { useAssigneeSources } from './members/assignee-avatars';

export type KanbanScroll = { x: number; cards: Map<string, number> };
const emptyCards: KanbanCard[] = [];

const Preview = memo(function Preview({
  card,
  summary,
  labels,
  members,
  dateFormat,
  onOpen,
  onCardActions,
  cardActionsDisabled,
}: {
  card: KanbanCard;
  summary?: CardPreviewSummary;
  labels: ReadonlyMap<string, KanbanLabel>;
  members: ReadonlyMap<string, KanbanAssignee>;
  dateFormat?: Intl.DateTimeFormat;
  onOpen: (card: KanbanCard) => void;
  onCardActions?: (card: KanbanCard) => void;
  cardActionsDisabled?: boolean;
}) {
  const c = useTheme();
  const due =
    card.dueDate &&
    (dateFormat
      ? dateFormat.format(new Date(card.dueDate))
      : `${card.dueDate.slice(0, 10)} UTC`);
  const knownLabels =
    summary?.labelIds.flatMap((id) => labels.get(id) ?? []) ?? [];
  const unresolvedLabels = (summary?.labelIds.length ?? 0) - knownLabels.length;
  const labelFallback = unresolvedLabels
    ? `${unresolvedLabels} unresolved ${unresolvedLabels === 1 ? 'label' : 'labels'}`
    : '';
  const known = card.assignees.flatMap(({ userId }) => {
    const member = members.get(userId);
    return member ? [member] : [];
  });
  const sources = useAssigneeSources(known.slice(0, 3));
  const people = known.map((member, index) => ({
    name: member.name,
    source: sources[index],
  }));
  const checklist = summary?.checklist;
  const checked = checklist?.totalItems
    ? `${checklist.checkedItems}/${checklist.totalItems} checklist items`
    : '';
  const attachments = summary?.attachmentCount
    ? `${summary.attachmentCount} attachments`
    : '';
  const comments = summary?.commentCount
    ? `${summary.commentCount} comments`
    : '';
  const accessibilityLabel = [
    card.title,
    card.isArchived && 'Archived',
    due && `Due ${due}`,
    ...knownLabels.map(({ name }) => name),
    labelFallback,
    checked,
    attachments,
    comments,
    card.assignees.length > 0 && `${card.assignees.length} assigned`,
    ...people.map(({ name }) => name),
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={() => onOpen(card)}
        style={({ pressed }) => ({
          flex: 1,
          opacity: pressed ? 0.72 : 1,
          minHeight: sizes.touch,
        })}
      >
        <CardPreview title={card.title} compact>
          <View style={styles.badges}>
            {knownLabels.map((label) => (
              <LabelChip
                key={label.id}
                label={label.name}
                compact
                colors={{
                  foreground: c.text,
                  background: c.primaryTint,
                  border: label.color,
                }}
              />
            ))}
            {!!labelFallback && <LabelChip label={labelFallback} compact />}
            {due && (
              <DueChip
                label={`Due ${due}`}
                compact
                tone={
                  Date.parse(card.dueDate!) < Date.now() ? 'danger' : 'info'
                }
              />
            )}
          </View>
          {!!checklist?.totalItems && (
            <View style={{ gap: spacing.xs }}>
              <Text style={[typography.caption, { color: c.textSecondary }]}>
                {checked}
              </Text>
              <ProgressBar
                label={checked}
                value={(100 * checklist.checkedItems) / checklist.totalItems}
              />
            </View>
          )}
          {!!(attachments || comments || card.assignees.length) && (
            <View style={styles.badges}>
              {people.length > 0 && (
                <AvatarStack size={24} people={people.slice(0, 3)} />
              )}
              {card.assignees.length > Math.min(people.length, 3) && (
                <Text style={[typography.caption, { color: c.textSecondary }]}>
                  {card.assignees.length} assigned
                </Text>
              )}
              {!!attachments && (
                <Text style={[typography.caption, { color: c.textSecondary }]}>
                  {attachments}
                </Text>
              )}
              {!!comments && (
                <Text style={[typography.caption, { color: c.textSecondary }]}>
                  {comments}
                </Text>
              )}
            </View>
          )}
        </CardPreview>
      </Pressable>
      {onCardActions && !card.isArchived && (
        <Button
          variant="icon"
          label={`Card actions for ${card.title}`}
          disabled={cardActionsDisabled}
          onPress={() => onCardActions(card)}
          icon={<Text style={[typography.section, { color: c.text }]}>⋯</Text>}
        />
      )}
    </View>
  );
});

export function useScrollRestore<T>(
  offset: number,
  complete: boolean,
  saveOffset: (offset: number) => void,
) {
  const list = useRef<FlatList<T>>(null);
  const pending = useRef(offset);
  const viewport = useRef(0);
  const content = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const restore = useCallback(
    (clamp: boolean) => {
      if (
        !pending.current ||
        !viewport.current ||
        content.current === null ||
        !list.current
      )
        return;
      const maxOffset = Math.max(0, content.current - viewport.current);
      if (!clamp && pending.current > maxOffset) return;
      const target = Math.min(Math.max(0, pending.current), maxOffset);
      pending.current = 0;
      saveOffset(target);
      list.current.scrollToOffset({ offset: target, animated: false });
    },
    [saveOffset],
  );
  const scheduleRestore = useCallback(() => {
    restore(false);
    if (!complete || !pending.current || frame.current !== null) return;
    // Give the final page's native layout a chance to report its content size.
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      restore(true);
    });
  }, [complete, restore]);
  useEffect(() => {
    scheduleRestore();
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [scheduleRestore]);
  const userScroll = useCallback(() => {
    pending.current = 0;
  }, []);
  return {
    list,
    setViewport: (size: number) => {
      viewport.current = size;
      scheduleRestore();
    },
    setContent: (size: number) => {
      content.current = size;
      scheduleRestore();
    },
    userScroll,
    restored: () => !pending.current,
  };
}

const ColumnPanel = memo(function ColumnPanel({
  column,
  index,
  width,
  cards,
  complete,
  loading,
  ready,
  previews,
  labels,
  members,
  dateFormat,
  scroll,
  onOpen,
  onColumnActions,
  columnActionsDisabled,
  onAddCard,
  onCardActions,
  cardActionsDisabled,
}: {
  column: KanbanColumn;
  index: number;
  width: number;
  cards: readonly KanbanCard[];
  complete: boolean;
  loading: boolean;
  ready: boolean;
  previews: ReadonlyMap<string, CardPreviewSummary>;
  labels: ReadonlyMap<string, KanbanLabel>;
  members: ReadonlyMap<string, KanbanAssignee>;
  dateFormat?: Intl.DateTimeFormat;
  scroll: KanbanScroll;
  onOpen: (card: KanbanCard) => void;
  onColumnActions?: (column: KanbanColumn) => void;
  columnActionsDisabled?: boolean;
  onAddCard?: (column: KanbanColumn) => void;
  onCardActions?: (card: KanbanCard) => void;
  cardActionsDisabled?: boolean;
}) {
  const c = useTheme();
  const saveOffset = useCallback(
    (offset: number) => {
      scroll.cards.set(column.id, offset);
    },
    [column.id, scroll],
  );
  const position = useScrollRestore<KanbanCard>(
    scroll.cards.get(column.id) ?? 0,
    complete && !loading,
    saveOffset,
  );
  return (
    <View
      style={[
        styles.panel,
        {
          width,
          backgroundColor: index % 2 ? c.primaryTint : c.surfaceSoft,
          borderColor: c.border,
        },
      ]}
    >
      <View style={styles.columnHeader}>
        <Text
          accessibilityRole="header"
          accessibilityLabel={column.name}
          numberOfLines={2}
          style={[typography.strong, { color: c.text, flex: 1 }]}
        >
          {column.name}
        </Text>
        {ready && (
          <Text
            style={[typography.caption, { color: c.textSecondary }]}
            accessibilityLabel={`${cards.length} cards${complete ? '' : ' loaded'}`}
          >
            {complete ? cards.length : `${cards.length} loaded`}
          </Text>
        )}
        {onColumnActions && (
          <Button
            variant="icon"
            label={`Column actions for ${column.name}`}
            disabled={columnActionsDisabled}
            onPress={() => onColumnActions(column)}
            icon={
              <Text style={[typography.section, { color: c.text }]}>⋯</Text>
            }
          />
        )}
      </View>
      {onAddCard && (
        <Button
          label="Add card"
          variant="link"
          disabled={cardActionsDisabled}
          onPress={() => onAddCard(column)}
        />
      )}
      <FlatList
        ref={position.list}
        style={{ flex: 1 }}
        data={cards}
        onLayout={(event) =>
          position.setViewport(event.nativeEvent.layout.height)
        }
        onContentSizeChange={(_, height) => position.setContent(height)}
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={5}
        keyExtractor={(item) => item.id}
        directionalLockEnabled
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        onScrollBeginDrag={position.userScroll}
        onScroll={(event) => {
          if (position.restored())
            saveOffset(event.nativeEvent.contentOffset.y);
        }}
        contentContainerStyle={styles.cards}
        ItemSeparatorComponent={CardGap}
        ListEmptyComponent={
          ready ? (
            <Text style={[typography.supporting, { color: c.textSecondary }]}>
              {complete
                ? 'No cards in this column.'
                : 'No cards loaded here yet.'}
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => (
          <Preview
            card={item}
            summary={previews.get(item.id)}
            labels={labels}
            members={members}
            dateFormat={dateFormat}
            onOpen={onOpen}
            onCardActions={onCardActions}
            cardActionsDisabled={cardActionsDisabled}
          />
        )}
      />
    </View>
  );
});

function CardGap() {
  return <View style={{ height: spacing.sm }} />;
}
function ColumnGap() {
  return <View style={{ width: spacing.sm }} />;
}

export function BoardKanban({
  columns,
  columnsComplete,
  groups,
  cardsReady,
  cardsComplete,
  cardsLoading,
  previews,
  labels,
  members,
  timeZone,
  scroll,
  onOpen,
  onColumnActions,
  onAddCard,
  onCardActions,
  cardActionsDisabled,
  columnActionsDisabled,
  revealColumnIndex = -1,
  onColumnRevealed,
}: {
  columns: readonly KanbanColumn[];
  columnsComplete: boolean;
  groups: ReadonlyMap<string, KanbanCard[]>;
  cardsReady: boolean;
  cardsComplete: boolean;
  cardsLoading: boolean;
  previews: ReadonlyMap<string, CardPreviewSummary>;
  labels: readonly KanbanLabel[];
  members: readonly KanbanAssignee[];
  timeZone?: string;
  scroll: KanbanScroll;
  onOpen: (card: KanbanCard) => void;
  onColumnActions?: (column: KanbanColumn) => void;
  onAddCard?: (column: KanbanColumn) => void;
  onCardActions?: (card: KanbanCard) => void;
  cardActionsDisabled?: boolean;
  columnActionsDisabled?: boolean;
  revealColumnIndex?: number;
  onColumnRevealed?: () => void;
}) {
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(280, Math.max(180, Math.round(width * 0.65)));
  const saveOffset = useCallback(
    (offset: number) => {
      scroll.x = offset;
    },
    [scroll],
  );
  const position = useScrollRestore<KanbanColumn>(
    scroll.x,
    columnsComplete,
    saveOffset,
  );
  const [listWidth, setListWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const { list, userScroll } = position;
  useEffect(() => {
    const columnEnd =
      (revealColumnIndex + 1) * panelWidth + revealColumnIndex * spacing.sm;
    if (
      !listWidth ||
      revealColumnIndex < 0 ||
      contentWidth < columnEnd ||
      !list.current
    )
      return;
    const frame = requestAnimationFrame(() => {
      if (!list.current) return;
      userScroll();
      list.current.scrollToIndex({ index: revealColumnIndex, animated: false });
      onColumnRevealed?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [
    list,
    listWidth,
    contentWidth,
    panelWidth,
    userScroll,
    revealColumnIndex,
    onColumnRevealed,
  ]);
  const labelMap = useMemo(
    () => new Map(labels.map((label) => [label.id, label])),
    [labels],
  );
  const memberMap = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );
  const dateFormat = useMemo(
    () =>
      timeZone
        ? new Intl.DateTimeFormat(undefined, {
            timeZone,
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : undefined,
    [timeZone],
  );
  return (
    <FlatList
      testID="board-columns"
      ref={position.list}
      style={{ flex: 1 }}
      horizontal
      data={columns}
      onLayout={(event) => {
        const width = event.nativeEvent.layout.width;
        position.setViewport(width);
        setListWidth(width);
      }}
      onContentSizeChange={(width) => {
        position.setContent(width);
        setContentWidth(width);
      }}
      initialNumToRender={Math.ceil(width / panelWidth) + 1}
      maxToRenderPerBatch={3}
      windowSize={3}
      keyExtractor={(item) => item.id}
      getItemLayout={(_, index) => ({
        index,
        length: panelWidth,
        offset: (panelWidth + spacing.sm) * index,
      })}
      ItemSeparatorComponent={ColumnGap}
      contentContainerStyle={styles.columns}
      directionalLockEnabled
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={32}
      onScrollBeginDrag={position.userScroll}
      onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
        if (position.restored()) saveOffset(event.nativeEvent.contentOffset.x);
      }}
      renderItem={({ item, index }) => (
        <ColumnPanel
          column={item}
          index={index}
          width={panelWidth}
          cards={groups.get(item.id) ?? emptyCards}
          complete={cardsComplete}
          loading={cardsLoading}
          ready={cardsReady}
          previews={previews}
          labels={labelMap}
          members={memberMap}
          dateFormat={dateFormat}
          scroll={scroll}
          onOpen={onOpen}
          onColumnActions={onColumnActions}
          onAddCard={onAddCard}
          onCardActions={onCardActions}
          cardActionsDisabled={cardActionsDisabled}
          columnActionsDisabled={columnActionsDisabled}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  columns: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    alignItems: 'stretch',
  },
  panel: { borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  cards: { paddingHorizontal: spacing.sm, paddingBottom: spacing.md },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
