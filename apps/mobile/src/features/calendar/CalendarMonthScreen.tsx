import {
  hashKey,
  useInfiniteQuery,
  useQueries,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';
import { Stack, useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import backIcon from 'expo-router/assets/react-navigation/elements/back-icon.png';
import logo from '../../../assets/brand/kanvexa-logo-v1.png';
import { ApiError } from '../../infrastructure/api/errors';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
import {
  deduplicatePages,
  nextPage,
} from '../../infrastructure/query/pagination';
import {
  useBoardRealtime,
  useRealtime,
} from '../../infrastructure/realtime/RealtimeProvider';
import { ResourceBoundary } from '../../navigation/resource-boundary';
import {
  destinationPath,
  parseResourceId,
  type ResourceId,
} from '../../navigation/routes';
import {
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusChip,
  ThemeContext,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { BoardFiltersSheet } from '../boards/BoardFiltersSheet';
import {
  useBoardViewFilters,
  useCalendarViewState,
} from '../boards/BoardViewFilters';
import { useScrollRestore } from '../boards/BoardKanban';
import {
  createKanbanApi,
  filterCount,
  isAccessDenied,
  type KanbanCard,
} from '../boards/kanban-api';
import { useKanbanCatalogs } from '../boards/kanban-queries';
import { hasExplicitBoardMembership } from '../boards/members/queries';
import { datePreferencesOptions } from '../cards/metadata/queries';
import { utcPreferences } from '../cards/metadata/dates';
import {
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from '../workspaces/status';
import { CalendarAgendaCard } from './CalendarAgenda';
import { MonthGrid } from './MonthGrid';
import { calendarToday, cardsByDueDay } from './due-groups';
import { dayCaption, shiftSelectedMonth } from './month-grid';
import { shiftSelectedWeek } from './week';
import { calendarCardOptions, calendarFilters } from './queries';
import { useCalendarClock } from './useCalendarClock';

export function CalendarMonthScreen({
  boardId,
}: {
  boardId: ResourceId | null;
}) {
  const session = useSessionSnapshot();
  if (!boardId || session.status !== 'authenticated')
    return <ResourceBoundary access="unavailable" />;
  return (
    <CalendarEntry
      key={`${session.user.id}:${session.generation}:${boardId}`}
      boardId={boardId}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}

function CalendarEntry({
  boardId,
  identity,
}: {
  boardId: ResourceId;
  identity: SessionIdentity;
}) {
  const data = useMobileData();
  const realtime = useRealtime();
  const focused = useIsFocused();
  const online = useWorkspaceOnline();
  const router = useRouter();
  const room = useBoardRealtime(boardId, focused, true);
  const [sharedFilters, setFilters] = useBoardViewFilters(boardId);
  const filters = calendarFilters(sharedFilters);
  const restoration = useCalendarViewState(
    `${identity.userId}:${identity.generation}:${boardId}`,
  );
  const [selected, select] = useState(restoration.selectedDay);
  const [view, changeView] = useState(restoration.view);
  const setSelected = (day: string | null) => {
    restoration.selectedDay = day;
    select(day);
  };
  const setView = (next: 'month' | 'week') => {
    if (next === view) return;
    // Both views derive the same provisional day while preferences load.
    // Switching must not turn the UTC fallback into an explicit selection.
    restoration.view = next;
    scroll.current.y = restoration.scroll[next];
    changeView(next);
  };
  const scroll = useRef({ y: restoration.scroll[view] });
  const [sheet, setSheet] = useState(false);
  const checking = room.status === 'checking';
  const revoked = room.status === 'unavailable';
  const boardKey = queryKeys.board(identity, boardId);
  const board = useQuery({
    queryKey: boardKey,
    enabled: focused && online && !checking && !revoked,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
    async queryFn({ signal }) {
      const current = data.resources.captureBoardProbe(boardId);
      try {
        const result = await createKanbanApi(data.api, identity, boardId).board(
          signal,
        );
        if (signal.aborted) throw new ApiError('aborted');
        data.assertCurrent(identity);
        current();
        if (!result) {
          realtime.revokeBoard(boardId);
          return null;
        }
        data.resources.confirmBoard(
          boardId,
          !result.isArchived && result.capabilities.canWriteBoard,
          result.workspaceId,
        );
        return result;
      } catch (error) {
        if (!signal.aborted && isAccessDenied(error)) {
          data.assertCurrent(identity);
          current();
          realtime.revokeBoard(boardId);
        }
        throw error;
      }
    },
  });
  const preferences = useQuery({
    ...datePreferencesOptions(data.api, identity),
    enabled: focused && online,
    // Preferences have no socket event. Reuse this session query on foreground
    // and a bounded focused poll to observe Web/device changes while reading.
    refetchInterval: focused && online ? 60_000 : false,
  });
  const prefs = preferences.data ?? utcPreferences;
  const verified =
    online &&
    !revoked &&
    !checking &&
    !!board.data &&
    board.isFetchedAfterMount &&
    !board.isFetching &&
    !board.isError &&
    data.resources.readable(boardKey);
  const cardsOptions = calendarCardOptions(
    data.api,
    identity,
    boardId,
    filters,
  );
  const cards = useQuery({ ...cardsOptions, enabled: focused && verified });
  const cardsKeyHash = hashKey(cardsOptions.queryKey);
  useEffect(() => {
    if (!focused) return;
    // No invisible page walks after pushing Card Detail, changing Board or filters.
    return () => {
      void data.queryClient.cancelQueries({
        queryKey: cardsOptions.queryKey,
        exact: true,
      });
    };
    // The hash is the normalized query identity, not a fresh object each render.
  }, [focused, cardsKeyHash, data.queryClient]);
  const boundary = useCallback(() => {
    if (filters.dueStatus && focused && verified)
      void cards.refetch({ cancelRefetch: false });
  }, [filters.dueStatus, focused, verified, cards.refetch]);
  const previousZone = useRef(prefs.timeZone);
  useEffect(() => {
    const changed = previousZone.current !== prefs.timeZone;
    previousZone.current = prefs.timeZone;
    // The server evaluates dueStatus in account timeZone, so regrouping alone
    // is insufficient when the saved zone changes under an active due filter.
    if (changed && filters.dueStatus && focused && verified) {
      // refetch alone reuses an initial fetch with no data. Cancel synchronously
      // first so its old-zone response cannot win or suppress the new walk.
      void data.queryClient.cancelQueries({
        queryKey: cardsOptions.queryKey,
        exact: true,
      });
      void cards.refetch();
    }
  }, [
    prefs.timeZone,
    filters.dueStatus,
    focused,
    verified,
    cards.refetch,
    cardsKeyHash,
    data.queryClient,
  ]);
  const now = useCalendarClock(focused, boundary);
  const today = calendarToday(prefs.timeZone, now);
  const day = selected ?? today;
  useEffect(() => {
    // Resolve the initial account-zone Today once; later preference changes keep
    // the chosen civil day. The clock still updates Today markers truthfully.
    if (
      !revoked &&
      board.data !== null &&
      selected === null &&
      (preferences.isSuccess || preferences.isError)
    )
      setSelected(today);
  }, [
    selected,
    preferences.isSuccess,
    preferences.isError,
    today,
    revoked,
    board.data === null,
  ]);
  const complete =
    verified &&
    cards.isSuccess &&
    !cards.isFetching &&
    !cards.isPaused &&
    (preferences.isSuccess || preferences.isError);
  const groups = useMemo(
    () => cardsByDueDay(complete ? (cards.data ?? []) : [], prefs.timeZone),
    [complete, cards.data, prefs.timeZone],
  );
  const agenda = groups.get(day) ?? [];
  const counts = useMemo(
    () => new Map([...groups].map(([date, values]) => [date, values.length])),
    [groups],
  );
  const api = createKanbanApi(data.api, identity, boardId);
  const columns = useInfiniteQuery({
    queryKey: queryKeys.columns(identity, boardId),
    initialPageParam: 1,
    getNextPageParam: (page: Awaited<ReturnType<typeof api.columns>>) =>
      nextPage(page.meta),
    queryFn: ({ pageParam, signal }) => api.columns(pageParam, signal),
    enabled: focused && verified,
  });
  useEffect(() => {
    if (
      focused &&
      verified &&
      columns.hasNextPage &&
      !columns.isFetching &&
      !columns.isError
    )
      void columns.fetchNextPage({ cancelRefetch: false });
  }, [
    focused,
    verified,
    columns.hasNextPage,
    columns.isFetching,
    columns.isError,
    columns.fetchNextPage,
  ]);
  const columnItems = useMemo(
    () =>
      columns.isError
        ? []
        : deduplicatePages(columns.data?.pages.map((page) => page.data) ?? []),
    [columns.data, columns.isError],
  );
  const canReadMembers =
    verified && hasExplicitBoardMembership(board.data ?? undefined);
  const catalogs = useKanbanCatalogs(
    data.api,
    identity,
    boardId,
    focused && verified,
    focused && canReadMembers,
  );
  // Workspace-visible readers can read Cards, not the restricted Board roster.
  // Even an older authorized roster cache must not supply names after downgrade.
  const authorizedCatalogs = {
    ...catalogs,
    memberItems: canReadMembers ? catalogs.memberItems : [],
  };
  const ids = agenda.map(({ id }) => id).sort();
  const batches = Array.from({ length: Math.ceil(ids.length / 100) }, (_, n) =>
    ids.slice(n * 100, n * 100 + 100),
  );
  const summaries = useQueries({
    queries: batches.map((ids) => ({
      queryKey: queryKeys.previewBatch(identity, boardId, ids),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.previews(ids, signal),
      enabled: focused && complete,
    })),
  });
  const previews = new Map(
    summaries
      .flatMap((query) => (query.isError ? [] : (query.data ?? [])))
      .map((summary) => [summary.cardId, summary]),
  );
  // Metadata catalogs are independent and optional. Load all pages when needed;
  // denied catalogs remain empty rather than inventing names from assignment IDs.
  useRemainingCatalogPages(catalogs.labels, focused && verified);
  useRemainingCatalogPages(catalogs.members, focused && canReadMembers);
  useEffect(() => {
    if (revoked || board.data === null) {
      setSelected(null);
      setFilters({});
      restoration.view = 'month';
      restoration.scroll = { month: 0, week: 0 };
      changeView('month');
      scroll.current.y = 0;
      setSheet(false);
    }
    // Shared updater is deliberately not an effect trigger.
  }, [revoked, board.data === null]);
  const retryReady = useWorkspaceRetryReady(
    cards.error ?? board.error,
    Math.max(cards.errorUpdatedAt, board.errorUpdatedAt),
  );
  const preferenceRetry = useWorkspaceRetryReady(
    preferences.error,
    preferences.errorUpdatedAt,
  );
  const saveScroll = useCallback(
    (y: number) => {
      scroll.current.y = y;
      restoration.scroll[view] = y;
    },
    [restoration, view],
  );

  function apply(next: Parameters<typeof calendarFilters>[0]) {
    setSheet(false);
    const active = calendarFilters(next);
    if (
      hashKey(
        calendarCardOptions(data.api, identity, boardId, active).queryKey,
      ) === cardsKeyHash
    )
      return;
    void data.queryClient.cancelQueries({
      queryKey: cardsOptions.queryKey,
      exact: true,
    });
    setFilters(active);
  }
  const open = (card: KanbanCard) => {
    const cardId = parseResourceId(card.id);
    if (
      focused &&
      complete &&
      cardId &&
      card.boardId === boardId &&
      data.resources.readable(boardKey)
    ) {
      setSelected(day);
      router.push(destinationPath({ kind: 'card', boardId, cardId }));
    }
  };
  return (
    <ThemeContext.Provider value={prefs.theme ?? 'system'}>
      <CalendarDocument
        {...{
          boardId,
          view,
          setView,
          focused,
          online,
          verified,
          revoked,
          checking,
          board,
          cards,
          complete,
          prefs,
          preferences,
          preferenceRetry,
          day,
          today,
          counts,
          agenda,
          columnItems,
          catalogs: authorizedCatalogs,
          previews,
          now,
          saveScroll,
          scroll,
          retryReady,
          setSelected,
          setSheet,
          open,
        }}
        retry={() => {
          realtime.retryBoard(boardId);
          void board.refetch();
          void cards.refetch();
        }}
        reset={() => apply({})}
        filtersCount={filterCount(filters)}
      />
      {sheet && focused && verified && (
        <BoardFiltersSheet
          calendar
          assigneesAvailable={canReadMembers}
          initial={filters}
          startWithLabels={false}
          catalogs={authorizedCatalogs}
          columns={columnItems}
          online={online}
          timeZone={prefs.timeZone}
          onCancel={() => setSheet(false)}
          onApply={apply}
        />
      )}
    </ThemeContext.Provider>
  );
}

function useRemainingCatalogPages(
  query:
    | ReturnType<typeof useKanbanCatalogs>['labels']
    | ReturnType<typeof useKanbanCatalogs>['members'],
  enabled: boolean,
) {
  useEffect(() => {
    if (enabled && query.hasNextPage && !query.isFetching && !query.isError)
      void query.fetchNextPage({ cancelRefetch: false });
  }, [
    enabled,
    query.hasNextPage,
    query.isFetching,
    query.isError,
    query.fetchNextPage,
  ]);
}

type DocumentProps = {
  boardId: ResourceId;
  view: 'month' | 'week';
  setView: (view: 'month' | 'week') => void;
  focused: boolean;
  online: boolean;
  verified: boolean;
  revoked: boolean;
  checking: boolean;
  board: UseQueryResult<import('../boards/kanban-api').KanbanBoard | null>;
  cards: UseQueryResult<KanbanCard[]>;
  complete: boolean;
  prefs: import('../cards/metadata/dates').DatePreferences;
  preferences: UseQueryResult<
    import('../cards/metadata/dates').DatePreferences
  >;
  preferenceRetry: boolean;
  day: string;
  today: string;
  counts: Map<string, number>;
  agenda: KanbanCard[];
  columnItems: import('../boards/kanban-api').KanbanColumn[];
  catalogs: ReturnType<typeof useKanbanCatalogs>;
  previews: Map<string, import('@kanban/shared').CardPreviewSummary>;
  now: number;
  saveScroll: (y: number) => void;
  scroll: { current: { y: number } };
  retryReady: boolean;
  setSelected: (day: string) => void;
  setSheet: (open: boolean) => void;
  open: (card: KanbanCard) => void;
  retry: () => void;
  reset: () => void;
  filtersCount: number;
};

function CalendarDocument(p: DocumentProps) {
  const c = useTheme();
  const router = useRouter();
  const count = p.filtersCount;
  const unavailable =
    p.revoked || p.board.data === null || isAccessDenied(p.board.error);
  const header = (
    <View style={styles.header}>
      <Button
        label="Back"
        variant="icon"
        icon={
          <Image
            source={backIcon}
            style={{ width: 20, height: 24, tintColor: c.text }}
          />
        }
        onPress={() =>
          router.canGoBack()
            ? router.back()
            : router.replace(
                destinationPath({ kind: 'board', boardId: p.boardId }),
              )
        }
      />
      <Image
        source={logo}
        accessibilityLabel="Kanvexa logo"
        resizeMode="contain"
        style={{ width: 32, height: 32 }}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[typography.section, { color: c.text }]}>Kanvexa</Text>
        <Text
          accessibilityRole="header"
          style={[typography.body, { color: c.textSecondary }]}
        >
          Calendar
        </Text>
        {p.verified && (
          <Text style={[typography.caption, { color: c.textSecondary }]}>
            {p.board.data?.name}
          </Text>
        )}
      </View>
      {p.verified && (
        <Button
          label={count ? `Filters (${count})` : 'Filters'}
          variant="link"
          onPress={() => p.setSheet(true)}
        />
      )}
    </View>
  );
  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      {unavailable ? (
        <>
          {header}
          <ResourceBoundary access="unavailable" />
        </>
      ) : !p.online ? (
        <>
          {header}
          <ErrorState
            title="Connection unavailable"
            description="Reconnect to verify Board access and load the complete calendar."
          />
        </>
      ) : !p.verified ? (
        <>
          {header}
          {p.board.isError && !p.checking ? (
            <ErrorState
              title="Couldn’t open calendar"
              description={workspaceErrorMessage(p.board.error)}
              action={
                <Button
                  label="Retry calendar"
                  disabled={!p.retryReady}
                  onPress={p.retry}
                />
              }
            />
          ) : (
            <Skeleton height={240} label="Checking Board access" />
          )}
        </>
      ) : (
        <CalendarList key={p.view} {...p} header={header} />
      )}
    </SafeAreaView>
  );
}

function CalendarList(p: DocumentProps & { header: React.ReactElement }) {
  const c = useTheme();
  const count = p.filtersCount;
  const position = useScrollRestore<KanbanCard>(
    p.scroll.current.y,
    p.complete,
    p.saveScroll,
  );
  const header = p.header;
  return (
    <FlatList
      ref={position.list}
      testID="calendar-agenda"
      data={p.complete ? p.agenda : []}
      keyExtractor={(card) => card.id}
      initialNumToRender={5}
      maxToRenderPerBatch={5}
      windowSize={5}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={32}
      onLayout={(event) =>
        position.setViewport(event.nativeEvent.layout.height)
      }
      onContentSizeChange={(_, height) => position.setContent(height)}
      onScrollBeginDrag={position.userScroll}
      onScroll={(event) => {
        if (position.restored())
          p.saveScroll(event.nativeEvent.contentOffset.y);
      }}
      ListHeaderComponent={
        <>
          {header}
          {p.board.data?.isArchived && (
            <View style={styles.notice}>
              <StatusChip label="Archived Board · Read-only" tone="info" />
            </View>
          )}
          <MonthGrid
            view={p.view}
            onViewChange={p.setView}
            selected={p.day}
            today={p.today}
            weekStartsOn={p.prefs.weekStartsOn ?? 'monday'}
            counts={p.complete ? p.counts : undefined}
            onSelect={p.setSelected}
            onPrevious={() =>
              p.setSelected(
                p.view === 'week'
                  ? shiftSelectedWeek(p.day, -1)
                  : shiftSelectedMonth(p.day, -1),
              )
            }
            onNext={() =>
              p.setSelected(
                p.view === 'week'
                  ? shiftSelectedWeek(p.day, 1)
                  : shiftSelectedMonth(p.day, 1),
              )
            }
            onToday={() =>
              p.setSelected(calendarToday(p.prefs.timeZone, Date.now()))
            }
          />
          <View style={styles.agendaHeading}>
            <Text
              accessibilityRole="header"
              style={[typography.section, { color: c.text }]}
            >
              {dayCaption(p.day)}
            </Text>
            {p.complete && (
              <Text
                accessibilityLiveRegion="polite"
                style={[
                  typography.caption,
                  typography.numeric,
                  { color: c.primaryPressed },
                ]}
              >
                {p.agenda.length} {p.agenda.length === 1 ? 'Card' : 'Cards'}
              </Text>
            )}
            <Text style={[typography.caption, { color: c.textSecondary }]}>
              {p.prefs.timeZone}
            </Text>
          </View>
          {p.preferences.isError && (
            <View style={styles.notice}>
              <Text style={[typography.supporting, { color: c.textSecondary }]}>
                Date preferences unavailable.{' '}
                {p.preferences.data
                  ? 'Using last verified account preferences.'
                  : 'Using UTC, Monday first.'}
              </Text>
              <Button
                label="Retry date preferences"
                variant="link"
                disabled={!p.preferenceRetry}
                onPress={() => void p.preferences.refetch()}
              />
            </View>
          )}
          {count > 0 && (
            <Button label="Clear filters" variant="link" onPress={p.reset} />
          )}
        </>
      }
      ListEmptyComponent={
        p.cards.isError ? (
          <ErrorState
            title="Calendar incomplete"
            description={
              p.cards.error instanceof ApiError &&
              p.cards.error.code === 'CALENDAR_INCOMPLETE'
                ? p.cards.error.message
                : workspaceErrorMessage(p.cards.error)
            }
            action={
              <Button
                label="Retry calendar"
                disabled={!p.retryReady || p.cards.isFetching}
                onPress={p.retry}
              />
            }
          />
        ) : !p.complete ? (
          <View style={styles.notice}>
            <Skeleton height={120} label="Loading every authorized Card page" />
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.supporting, { color: c.textSecondary }]}
            >
              Loading complete calendar… Counts are unavailable until every page
              is verified.
            </Text>
          </View>
        ) : (
          <EmptyState
            title="No Cards due this day"
            description={
              count
                ? 'Choose another day or clear filters to see more deadlines.'
                : 'Choose another day. Set a due date in an existing Card to see it here.'
            }
          />
        )
      }
      renderItem={({ item }) => (
        <CalendarAgendaCard
          card={item}
          boardName={p.board.data!.name}
          column={p.columnItems.find(({ id }) => id === item.columnId)?.name}
          preferences={p.prefs}
          now={p.now}
          summary={p.previews.get(item.id)}
          labels={p.catalogs.labelItems}
          members={p.catalogs.memberItems}
          onOpen={p.open}
        />
      )}
      ListFooterComponent={<View style={{ height: spacing.xxl }} />}
    />
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  agendaHeading: {
    padding: spacing.lg,
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  notice: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
});
