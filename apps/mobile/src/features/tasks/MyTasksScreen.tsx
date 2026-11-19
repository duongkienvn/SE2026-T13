import {
  focusManager,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { useIsFocused, useRouter } from 'expo-router';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TaskCardSummary, TaskGroup } from '@kanban/shared';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client';
import { ApiError } from '../../infrastructure/api/errors';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
import { TabHeader } from '../../navigation/scaffold';
import {
  Button,
  FilterChip,
  LoadingState,
  Skeleton,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { datePreferencesOptions } from '../cards/metadata/queries';
import { utcPreferences } from '../cards/metadata/dates';
import {
  canRetryWorkspace,
  useWorkspaceOnline,
  useWorkspaceRetryReady,
} from '../workspaces/status';
import {
  emptyTaskSelection,
  selectBoard,
  taskDateFilters,
  type TaskSelection,
} from './filters';
import { tasksOptions, taskCollection } from './queries';
import { taskGroups } from './decoder';
import { groupLabels, TaskSections } from './TaskSections';
import { TaskFiltersSheet } from './TaskFiltersSheet';
import { verifyTaskDestination } from './navigation';

const subscribeFocus = focusManager.subscribe.bind(focusManager);
const foregroundSnapshot = () => focusManager.isFocused();

export function MyTasksScreen() {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated') return null;
  return (
    <TaskList
      key={session.user.id + ':' + session.generation}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}

function TaskList({ identity }: { identity: SessionIdentity }) {
  const data = useMobileData();
  const router = useRouter();
  const focused = useIsFocused();
  const foreground = useSyncExternalStore(subscribeFocus, foregroundSnapshot);
  const online = useWorkspaceOnline();
  const c = useTheme();
  const [selection, setSelection] = useState<TaskSelection>(emptyTaskSelection);
  const [group, setGroup] = useState<'ALL' | TaskGroup>('ALL');
  const [sheet, setSheet] = useState(false);
  const [notice, setNotice] = useState('');
  const [opening, setOpening] = useState<string>();
  const navigation = useRef<AbortController | null>(null);
  const pageRequest = useRef(false);
  const eligible = focused && foreground && online;
  const preferences = useQuery({
    ...datePreferencesOptions(data.api, identity, ''),
    enabled: eligible,
  });
  const dates = preferences.data ?? utcPreferences;
  const filters = useMemo(() => {
    try {
      return {
        value: { ...taskDateFilters(selection, dates.timeZone), group },
        error: '',
      };
    } catch {
      return {
        value: { group, sort: selection.sort },
        error:
          'The selected date range is unavailable in your time zone. Update the date filters.',
      };
    }
  }, [selection, dates.timeZone, group]);
  const options = tasksOptions(data, identity, filters.value, dates.timeZone);
  const tasks = useInfiniteQuery({
    ...options,
    enabled: ({ state }) =>
      eligible &&
      !preferences.isPending &&
      !filters.error &&
      canRetryWorkspace(state.error, state.errorUpdatedAt),
  });
  const retry = useWorkspaceRetryReady(tasks.error, tasks.errorUpdatedAt);
  const error = tasks.error instanceof ApiError ? tasks.error : null;
  const permissionRisk =
    error?.kind === 'session-changed' ||
    error?.kind === 'unauthenticated' ||
    [401, 403, 404].includes(error?.status ?? 0);
  const usable =
    online &&
    !filters.error &&
    !permissionRisk &&
    (!tasks.isError || tasks.isFetchNextPageError) &&
    tasks.isFetchedAfterMount;
  const pages = usable ? (tasks.data?.pages ?? []) : [];
  const rows = taskCollection(pages);
  const counts = pages.at(-1)?.groupCounts;
  const total = counts
    ? Object.values(counts).reduce((a, b) => a + b, 0)
    : undefined;
  const refresh = () => {
    if (
      !eligible ||
      !retry ||
      tasks.isFetching ||
      !sameIdentity(identity, data.getIdentity())
    )
      return;
    void tasks.refetch({ cancelRefetch: false });
  };
  const changeSelection = (next: TaskSelection, nextGroup = group) => {
    if (
      nextGroup === group &&
      JSON.stringify(next) === JSON.stringify(selection)
    ) {
      setSheet(false);
      return;
    }
    const nextFilters = {
      ...taskDateFilters(next, dates.timeZone),
      group: nextGroup,
    };
    const key = tasksOptions(
      data,
      identity,
      nextFilters,
      dates.timeZone,
    ).queryKey;
    data.queryClient.removeQueries({ queryKey: key, exact: true });
    setSelection(next);
    setGroup(nextGroup);
    setSheet(false);
    setNotice('');
  };
  useEffect(() => {
    if (
      eligible &&
      !preferences.isPending &&
      !filters.error &&
      canRetryWorkspace(tasks.error, tasks.errorUpdatedAt)
    )
      void tasks.refetch({ cancelRefetch: false });
    // Refresh once on a tab/foreground/reconnect transition. Query owns request deduplication.
  }, [eligible]);
  useEffect(() => {
    if (!focused) navigation.current?.abort();
    return () => navigation.current?.abort();
  }, [focused]);
  useEffect(() => {
    const reset = (boardId?: string) => {
      if (boardId && boardId !== selection.boardId) return;
      if (
        boardId &&
        data.resources.readable(queryKeys.board(identity, boardId))
      )
        return;
      navigation.current?.abort();
      setOpening(undefined);
      setSheet(false);
      setSelection((current) => selectBoard(current));
      setNotice('Board access changed. Board and label filters were cleared.');
    };
    return data.resources.subscribeBoardTeardown(reset);
  }, [data, identity, selection.boardId]);
  useEffect(
    () =>
      data.resources.subscribeDenied((boardId, key) => {
        if (boardId !== selection.boardId || key[6] !== 'labels') return;
        setSheet(false);
        setSelection((current) => selectBoard(current));
        setNotice(
          'Board labels are unavailable. Board and label filters were cleared.',
        );
      }),
    [data, selection.boardId],
  );
  useEffect(
    () =>
      data.resources.subscribeWorkspaceDenied((id) => {
        if (selection.workspaceId !== id) return;
        setSheet(false);
        setSelection(emptyTaskSelection);
        setNotice('Workspace access changed. Filters were cleared.');
      }),
    [data, selection.workspaceId],
  );
  async function open(task: TaskCardSummary) {
    if (!eligible || opening || navigation.current || !usable) return;
    const snapshot = data.queryClient.getQueryData(options.queryKey);
    if (snapshot !== tasks.data) return;
    const controller = new AbortController();
    navigation.current = controller;
    setOpening(task.id);
    setNotice('');
    try {
      const path = await verifyTaskDestination(
        data,
        identity,
        task,
        controller.signal,
      );
      if (
        !controller.signal.aborted &&
        sameIdentity(identity, data.getIdentity()) &&
        data.queryClient.getQueryData(options.queryKey) === snapshot
      )
        router.navigate(path);
    } catch {
      if (
        !controller.signal.aborted &&
        sameIdentity(identity, data.getIdentity())
      )
        setNotice(
          'This Card is unavailable or access could not be verified. Refresh tasks to try again.',
        );
    } finally {
      if (navigation.current === controller) navigation.current = null;
      if (!controller.signal.aborted) setOpening(undefined);
    }
  }
  const loadMore = async () => {
    if (
      !eligible ||
      !retry ||
      tasks.isFetching ||
      pageRequest.current ||
      !tasks.hasNextPage
    )
      return;
    pageRequest.current = true;
    try {
      await tasks.fetchNextPage({ cancelRefetch: false });
    } finally {
      pageRequest.current = false;
    }
  };
  const message = !online
    ? 'You’re offline. Reconnect to load your tasks.'
    : error?.status === 429
      ? 'Too many requests. Wait before trying again.'
      : tasks.isError
        ? tasks.isFetchNextPageError
          ? 'Couldn’t load the next page. Your loaded tasks are below.'
          : 'Couldn’t verify your tasks. Refresh to try again.'
        : undefined;
  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      <ScrollView
        testID="my-tasks-scroll"
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
        refreshControl={
          <RefreshControl
            testID="tasks-refresh"
            refreshing={tasks.isRefetching && !tasks.isFetchingNextPage}
            onRefresh={refresh}
            tintColor={c.primary}
          />
        }
      >
        <TabHeader search />
        <View style={{ gap: spacing.xs }}>
          <Text
            accessibilityRole="header"
            style={[typography.display, { color: c.text }]}
          >
            My Tasks
          </Text>
          <Text style={[typography.body, { color: c.textSecondary }]}>
            All tasks assigned to you, across workspaces.
          </Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: spacing.sm,
            paddingVertical: spacing.xs,
          }}
        >
          {(['ALL', ...taskGroups] as const).map((value) => {
            const count = value === 'ALL' ? total : counts?.[value];
            return (
              <FilterChip
                key={value}
                selected={group === value}
                label={
                  groupLabels[value] +
                  (count === undefined ? '' : ' · ' + count)
                }
                onPress={() => {
                  setNotice('');
                  changeSelection(selection, value);
                }}
              />
            );
          })}
        </ScrollView>
        <Button
          label="Filter and sort tasks"
          variant="secondary"
          onPress={() => setSheet(true)}
        />
        <Text style={[typography.supporting, { color: c.textSecondary }]}>
          Dates in {dates.timeZone}
        </Text>
        {preferences.isError && (
          <Text style={{ color: c.textSecondary }}>
            Couldn’t refresh date preferences. Dates use {dates.timeZone}.
          </Text>
        )}
        {!!notice && (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.body, { color: c.text }]}
          >
            {notice}
          </Text>
        )}
        {!!filters.error && (
          <Text accessibilityLiveRegion="polite" style={{ color: c.danger }}>
            {filters.error}
          </Text>
        )}
        {!!message && (
          <View style={{ gap: spacing.sm }}>
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.text }]}
            >
              {message}
            </Text>
            <Button
              label={
                tasks.isFetchNextPageError ? 'Retry load more' : 'Retry tasks'
              }
              disabled={!eligible || !retry || tasks.isFetching}
              onPress={
                tasks.isFetchNextPageError ? () => void loadMore() : refresh
              }
            />
          </View>
        )}
        {!tasks.data && tasks.isFetching && (
          <View testID="tasks-skeleton" style={{ gap: spacing.md }}>
            <Skeleton width="90%" height={70} />
            <Skeleton width="90%" height={70} />
            <Skeleton width="90%" height={70} />
          </View>
        )}
        {usable && !!pages.length && !rows.length && (
          <Text style={[typography.body, { color: c.textSecondary }]}>
            {group === 'ALL'
              ? 'No assigned tasks match these filters.'
              : 'No tasks in this group.'}
          </Text>
        )}
        <TaskSections
          rows={rows}
          preferences={dates}
          disabled={!eligible || !!opening || permissionRisk}
          opening={opening}
          open={(task) => void open(task)}
        />
        {usable && !!pages.length && (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.supporting, { color: c.textSecondary }]}
          >
            {rows.length} loaded · {pages.at(-1)!.meta.total} matching tasks
          </Text>
        )}
        {tasks.hasNextPage && usable && (
          <Button
            label="Load more tasks"
            variant="secondary"
            loading={tasks.isFetchingNextPage}
            disabled={!eligible || !retry || tasks.isFetching}
            onPress={() => void loadMore()}
          />
        )}
        {tasks.isFetchingNextPage && (
          <LoadingState label="Loading next task page" />
        )}
      </ScrollView>
      {sheet && (
        <TaskFiltersSheet
          identity={identity}
          current={selection}
          online={online && focused && foreground}
          timeZone={dates.timeZone}
          close={() => setSheet(false)}
          apply={(next) => changeSelection(next)}
        />
      )}
    </SafeAreaView>
  );
}
