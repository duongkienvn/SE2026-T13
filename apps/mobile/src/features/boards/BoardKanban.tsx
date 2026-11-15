import { memo, useMemo, useRef } from 'react';
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

export type KanbanScroll = { x: number; cards: Map<string, number> };
const emptyCards: KanbanCard[] = [];

const Preview = memo(function Preview({
  card,
  summary,
  labels,
  members,
  dateFormat,
  onOpen,
}: {
  card: KanbanCard;
  summary?: CardPreviewSummary;
  labels: ReadonlyMap<string, KanbanLabel>;
  members: ReadonlyMap<string, KanbanAssignee>;
  dateFormat?: Intl.DateTimeFormat;
  onOpen: (card: KanbanCard) => void;
}) {
  const c = useTheme();
  const due =
    card.dueDate &&
    (dateFormat
      ? dateFormat.format(new Date(card.dueDate))
      : `${card.dueDate.slice(0, 10)} UTC`);
  const knownLabels =
    summary?.labelIds.flatMap((id) => labels.get(id) ?? []) ?? [];
  const people = card.assignees.flatMap(({ userId }) => {
    const member = members.get(userId);
    return member
      ? [
          {
            name: member.name,
            source: member.avatarUrl ? { uri: member.avatarUrl } : undefined,
          },
        ]
      : [];
  });
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
    checked,
    attachments,
    comments,
    card.assignees.length > 0 && `${card.assignees.length} assigned`,
    ...people.map(({ name }) => name),
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => onOpen(card)}
      style={({ pressed }) => ({
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
          {due && (
            <DueChip
              label={`Due ${due}`}
              compact
              tone={Date.parse(card.dueDate!) < Date.now() ? 'danger' : 'info'}
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
  );
});

function useScrollRestore<T>(offset: number) {
  const list = useRef<FlatList<T>>(null);
  const pending = useRef(offset);
  const viewport = useRef(0);
  const content = useRef(0);
  function restore() {
    if (
      pending.current &&
      viewport.current &&
      content.current >= viewport.current + pending.current
    ) {
      const target = pending.current;
      pending.current = 0;
      list.current?.scrollToOffset({ offset: target, animated: false });
    }
  }
  return {
    list,
    setViewport: (size: number) => {
      viewport.current = size;
      restore();
    },
    setContent: (size: number) => {
      content.current = size;
      restore();
    },
    userScroll: () => {
      pending.current = 0;
    },
    restored: () => !pending.current,
  };
}

const ColumnPanel = memo(function ColumnPanel({
  column,
  index,
  width,
  cards,
  complete,
  ready,
  previews,
  labels,
  members,
  dateFormat,
  scroll,
  onOpen,
}: {
  column: KanbanColumn;
  index: number;
  width: number;
  cards: readonly KanbanCard[];
  complete: boolean;
  ready: boolean;
  previews: ReadonlyMap<string, CardPreviewSummary>;
  labels: ReadonlyMap<string, KanbanLabel>;
  members: ReadonlyMap<string, KanbanAssignee>;
  dateFormat?: Intl.DateTimeFormat;
  scroll: KanbanScroll;
  onOpen: (card: KanbanCard) => void;
}) {
  const c = useTheme();
  const position = useScrollRestore<KanbanCard>(
    scroll.cards.get(column.id) ?? 0,
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
      </View>
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
            scroll.cards.set(column.id, event.nativeEvent.contentOffset.y);
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
  groups,
  cardsReady,
  cardsComplete,
  previews,
  labels,
  members,
  timeZone,
  scroll,
  onOpen,
}: {
  columns: readonly KanbanColumn[];
  groups: ReadonlyMap<string, KanbanCard[]>;
  cardsReady: boolean;
  cardsComplete: boolean;
  previews: ReadonlyMap<string, CardPreviewSummary>;
  labels: readonly KanbanLabel[];
  members: readonly KanbanAssignee[];
  timeZone?: string;
  scroll: KanbanScroll;
  onOpen: (card: KanbanCard) => void;
}) {
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(280, Math.max(180, Math.round(width * 0.65)));
  const position = useScrollRestore<KanbanColumn>(scroll.x);
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
      onLayout={(event) => position.setViewport(event.nativeEvent.layout.width)}
      onContentSizeChange={(contentWidth) => position.setContent(contentWidth)}
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
        if (position.restored()) scroll.x = event.nativeEvent.contentOffset.x;
      }}
      renderItem={({ item, index }) => (
        <ColumnPanel
          column={item}
          index={index}
          width={panelWidth}
          cards={groups.get(item.id) ?? emptyCards}
          complete={cardsComplete}
          ready={cardsReady}
          previews={previews}
          labels={labelMap}
          members={memberMap}
          dateFormat={dateFormat}
          scroll={scroll}
          onOpen={onOpen}
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
