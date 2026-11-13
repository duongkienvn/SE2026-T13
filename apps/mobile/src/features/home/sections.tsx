import { useState, type ReactNode } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  TaskGroup,
  type HomeBoardSummary,
  type HomeDashboard,
  type TaskCardSummary,
} from '@kanban/shared';
import tasksIcon from '../../../assets/navigation/tasks.png';
import {
  Button,
  Separator,
  elevation,
  radius,
  sizes,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { BoardArtwork } from './BoardArtwork';
import { dueLabel, formatHomeDate } from './presentation';

function HomePressable({
  style,
  ...props
}: Omit<PressableProps, 'style'> & {
  style: (state: {
    pressed: boolean;
    focused: boolean;
  }) => StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...props}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => style({ pressed, focused })}
    />
  );
}
export function HomeHeading({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  const c = useTheme();
  return (
    <View style={styles.heading}>
      <Text
        accessibilityRole="header"
        style={[typography.section, { color: c.text, flex: 1 }]}
      >
        {title}
      </Text>
      {action && onPress && (
        <Button label={action} variant="link" onPress={onPress} />
      )}
    </View>
  );
}

function TileSymbol({ due }: { due: boolean }) {
  const c = useTheme();
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[
        styles.tileSymbol,
        { backgroundColor: due ? c.surfaceSoft : c.primaryTint },
      ]}
    >
      {due ? (
        <View style={[styles.clock, { borderColor: c.warning }]}>
          <View style={[styles.clockHand, { borderColor: c.warning }]} />
        </View>
      ) : (
        <Image
          source={tasksIcon}
          style={{ width: 22, height: 22, tintColor: c.focus }}
        />
      )}
    </View>
  );
}

export function SummaryTiles({
  summary,
  openTasks,
}: {
  summary?: HomeDashboard['summary'];
  openTasks?: () => void;
}) {
  const c = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const stacked =
    Math.min(width - 2 * spacing.xl, sizes.contentMax) /
      Math.max(1, fontScale) <
    190;
  return (
    <View style={[styles.tiles, stacked && { flexDirection: 'column' }]}>
      {(['My tasks', 'Due soon'] as const).map((label) => {
        const due = label === 'Due soon';
        const value = due
          ? summary?.dueNext7DaysCount
          : summary?.assignedActiveCount;
        const content = (
          <>
            <TileSymbol due={due} />
            {value === undefined ? (
              <Placeholder width="38%" height={35} />
            ) : (
              <Text
                style={[
                  typography.display,
                  typography.numeric,
                  { color: c.text },
                ]}
              >
                {value}
              </Text>
            )}
            <View style={styles.tileLabel}>
              <Text
                style={[typography.body, { flex: 1, color: c.textSecondary }]}
              >
                {label}
              </Text>
              {value !== undefined && <Chevron />}
            </View>
          </>
        );
        const frame = [
          styles.tile,
          elevation.surface,
          { backgroundColor: c.surface, borderColor: c.border },
        ];
        return value === undefined ? (
          <View key={label} style={frame}>
            {content}
          </View>
        ) : (
          <HomePressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={`${label}, ${value}. Open My Tasks`}
            onPress={openTasks}
            style={({ pressed, focused }) => [
              frame,
              pressed && { opacity: 0.8 },
              focused && { borderColor: c.focus },
            ]}
          >
            {content}
          </HomePressable>
        );
      })}
    </View>
  );
}

function Chevron() {
  const c = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.chevron, { borderColor: c.textMuted }]}
    />
  );
}

function Panel({ children }: { children: ReactNode }) {
  const c = useTheme();
  return (
    <View
      style={[
        styles.panel,
        elevation.surface,
        { backgroundColor: c.surface, borderColor: c.border },
      ]}
    >
      {children}
    </View>
  );
}

function PreviewRow({
  label,
  title,
  metadata,
  leading,
  trailing,
  onPress,
}: {
  label: string;
  title: string;
  metadata?: ReactNode;
  leading: ReactNode;
  trailing?: ReactNode;
  onPress: () => void;
}) {
  const c = useTheme();
  return (
    <HomePressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed, focused }) => [
        styles.row,
        {
          borderColor: focused ? c.focus : 'transparent',
          backgroundColor: pressed ? c.surfaceSoft : c.surface,
        },
      ]}
    >
      {leading}
      <View style={styles.rowContent}>
        <Text numberOfLines={2} style={[typography.strong, { color: c.text }]}>
          {title}
        </Text>
        {metadata}
      </View>
      {trailing}
    </HomePressable>
  );
}

function PreviewMeta({ children }: { children: ReactNode }) {
  const c = useTheme();
  return (
    <Text
      numberOfLines={2}
      style={[typography.supporting, { color: c.textSecondary }]}
    >
      {children}
    </Text>
  );
}

export function UpNext({
  tasks,
  now,
  openCard,
}: {
  tasks: TaskCardSummary[];
  now: Date;
  openCard: (task: TaskCardSummary) => void;
}) {
  const c = useTheme();
  if (!tasks.length)
    return (
      <Panel>
        <Empty text="No assigned tasks with due dates." />
      </Panel>
    );
  return (
    <Panel>
      {tasks.map((task, index) => {
        const due = dueLabel(task, now);
        const labelNames = task.labels.map((label) => label.name);
        const dueColor =
          task.group === TaskGroup.OVERDUE
            ? c.danger
            : task.group === TaskGroup.NEXT_7_DAYS
              ? c.info
              : c.textSecondary;
        return (
          <View key={task.id}>
            {index > 0 && <Separator />}
            <PreviewRow
              label={`Open ${task.title}, ${task.boardName}, ${task.workspaceName}, ${due}${labelNames.length ? ', Labels: ' + labelNames.join(', ') : ''}`}
              title={task.title}
              leading={
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  style={[styles.taskMarker, { borderColor: c.controlBorder }]}
                />
              }
              trailing={<Chevron />}
              metadata={
                <>
                  <View style={styles.taskMeta}>
                    <Text
                      numberOfLines={1}
                      style={[
                        typography.supporting,
                        styles.taskBoard,
                        { color: c.textSecondary },
                      ]}
                    >
                      {task.boardName} · {task.workspaceName}
                    </Text>
                    <Text
                      style={[
                        typography.caption,
                        styles.dueBadge,
                        { color: dueColor, backgroundColor: c.surfaceSoft },
                      ]}
                    >
                      {due}
                    </Text>
                  </View>
                  {labelNames.length > 0 && (
                    <PreviewMeta>{labelNames.join(' · ')}</PreviewMeta>
                  )}
                </>
              }
              onPress={() => openCard(task)}
            />
          </View>
        );
      })}
    </Panel>
  );
}

export function BoardCollection({
  kind,
  boards,
  openBoard,
}: {
  kind: 'starred' | 'recent';
  boards: HomeBoardSummary[];
  openBoard: (board: HomeBoardSummary) => void;
}) {
  const c = useTheme();
  const starred = kind === 'starred';
  return (
    <View style={{ gap: spacing.sm }}>
      <Text
        accessibilityRole="header"
        style={[typography.strong, { color: c.textSecondary }]}
      >
        {starred ? 'Starred Boards' : 'Recent Boards'}
      </Text>
      <Panel>
        {!boards.length && (
          <Empty
            text={
              starred ? 'No starred boards yet.' : 'No recently viewed boards.'
            }
          />
        )}
        {boards.map((board, index) => {
          const viewed =
            !starred && board.lastViewedAt
              ? `Viewed ${formatHomeDate(new Date(board.lastViewedAt))}`
              : '';
          const metadata = [board.isStarred && 'Starred', viewed]
            .filter(Boolean)
            .join(' · ');
          return (
            <View key={board.id}>
              {index > 0 && <Separator />}
              <PreviewRow
                label={`Open board ${board.name}${metadata ? ', ' + metadata : ''}`}
                title={board.name}
                leading={<BoardArtwork preset={board.backgroundPreset} />}
                trailing={<Chevron />}
                metadata={
                  metadata ? <PreviewMeta>{metadata}</PreviewMeta> : undefined
                }
                onPress={() => openBoard(board)}
              />
            </View>
          );
        })}
      </Panel>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  const c = useTheme();
  return (
    <Text style={[styles.empty, typography.body, { color: c.textSecondary }]}>
      {text}
    </Text>
  );
}

function Placeholder({
  width,
  height,
}: {
  width: `${number}%`;
  height: number;
}) {
  const c = useTheme();
  return (
    <View
      style={{
        width,
        height,
        borderRadius: radius.small,
        backgroundColor: c.progressTrack,
      }}
    />
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <Panel>
      {Array.from({ length: count }, (_, i) => (
        <View key={i}>
          {i > 0 && <Separator />}
          <View style={styles.row}>
            <View style={{ width: 40 }}>
              <Placeholder width="100%" height={32} />
            </View>
            <View style={styles.rowContent}>
              <Placeholder width="70%" height={14} />
              <Placeholder width="46%" height={12} />
            </View>
          </View>
        </View>
      ))}
    </Panel>
  );
}

export function HomeSkeleton() {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading Home"
      style={styles.skeleton}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={styles.skeleton}
      >
        <SummaryTiles />
        <View>
          <HomeHeading title="Up next" />
          <SkeletonRows count={3} />
        </View>
        <View>
          <HomeHeading title="Your boards" />
          <SkeletonRows count={2} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing.md },
  tile: {
    flex: 1,
    minWidth: 0,
    minHeight: 130,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.xs,
  },
  tileLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingRight: spacing.xs,
  },
  tileSymbol: {
    width: 36,
    height: 36,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  clock: {
    width: 21,
    height: 21,
    borderWidth: 2,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockHand: {
    height: 7,
    width: 6,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    marginLeft: 4,
    marginBottom: 4,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: sizes.touch,
    gap: spacing.sm,
  },
  chevron: {
    width: 8,
    height: 8,
    borderTopWidth: 2,
    borderRightWidth: 2,
    transform: [{ rotate: '45deg' }],
    marginRight: spacing.xs,
  },
  panel: { borderRadius: radius.card, borderWidth: 1, overflow: 'hidden' },
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderWidth: 2,
    gap: spacing.md,
  },
  rowContent: { flex: 1, minWidth: 0, gap: spacing.xs },
  taskMarker: {
    width: 19,
    height: 19,
    borderWidth: 1.5,
    borderRadius: radius.pill,
  },
  taskMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dueBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  taskBoard: { flexShrink: 1, minWidth: 90 },
  empty: { padding: spacing.lg },
  skeleton: { gap: spacing.lg },
});
