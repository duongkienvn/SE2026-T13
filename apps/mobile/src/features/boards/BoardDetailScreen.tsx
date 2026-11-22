import { hashKey, useQuery } from '@tanstack/react-query';
import { useIsFocused, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../../infrastructure/api/errors';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
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
  AppHeader,
  Button,
  EmptyState,
  ErrorState,
  FilterChip,
  Skeleton,
  StatusChip,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { CardActionsSheet } from '../cards/CardActionsSheet';
import { datePreferencesOptions } from '../cards/metadata/queries';
import {
  useCardLifecycle,
  type CardLifecycle,
} from '../cards/useCardLifecycle';
import { ColumnActionsSheet } from '../columns/ColumnActionsSheet';
import { canMutateColumns } from '../columns/mutations';
import {
  useColumnManagement,
  type ColumnManagement,
} from '../columns/useColumnManagement';
import { BoardArtwork } from '../home/BoardArtwork';
import {
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from '../workspaces/status';
import { createBoardApi } from './api';
import { BoardFiltersSheet, dueOptions } from './BoardFiltersSheet';
import { BoardKanban, type KanbanScroll } from './BoardKanban';
import { BoardStar } from './BoardStar';
import { BoardPresence } from './BoardPresence';
import type { BoardRealtimeState } from '../../infrastructure/realtime/rooms';
import { BoardTable } from './table/BoardTable';
import {
  createKanbanApi,
  filterCount,
  isAccessDenied,
  normalizeKanbanFilters,
  type KanbanBoard,
  type KanbanCard,
  type KanbanFilters,
} from './kanban-api';
import {
  kanbanCardOptions,
  useBoardKanban,
  useKanbanCatalogs,
} from './kanban-queries';
import { boardStarKey } from './star';
import { useBoardViewFilters } from './BoardViewFilters';

export function BoardDetailScreen({ boardId }: { boardId: ResourceId | null }) {
  const session = useSessionSnapshot();
  const identity = useMemo(
    () =>
      session.status === 'authenticated'
        ? { userId: session.user.id, generation: session.generation }
        : null,
    [session],
  );
  if (!boardId || !identity) return <ResourceBoundary access="unavailable" />;
  return (
    <BoardEntry
      key={`${identity.userId}:${identity.generation}:${boardId}`}
      boardId={boardId}
      identity={identity}
    />
  );
}

function BoardEntry({
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
  const room = useBoardRealtime(boardId, focused, true);
  const c = useTheme();
  const boardKey = queryKeys.board(identity, boardId);
  const recorded = useRef(false);
  const scroll = useRef<KanbanScroll>({ x: 0, cards: new Map() });
  const [filters, setFilters] = useBoardViewFilters(boardId);
  const [view, setView] = useState<'board' | 'table'>('board');
  const tableScroll = useRef({ y: 0 });
  const checking = room.status === 'checking';
  const revoked = room.status === 'unavailable';
  const detail = useQuery({
    queryKey: boardKey,
    enabled: focused && !checking && !revoked,
    staleTime: 0,
    refetchOnMount: 'always',
    async queryFn({ signal }) {
      const current = data.resources.captureBoardProbe(boardId);
      const api = createKanbanApi(data.api, identity, boardId);
      let board;
      try {
        board = await api.board(signal);
      } catch (error) {
        if (!signal.aborted && isAccessDenied(error)) {
          data.assertCurrent(identity);
          current();
          realtime.revokeBoard(boardId);
        }
        throw error;
      }
      if (signal.aborted) throw new ApiError('aborted');
      data.assertCurrent(identity);
      current();
      if (!board) {
        realtime.revokeBoard(boardId);
        return null;
      }
      data.resources.confirmBoard(
        boardId,
        !board.isArchived && board.capabilities.canWriteBoard,
        board.workspaceId,
      );
      return board;
    },
  });
  const retryReady = useWorkspaceRetryReady(
    detail.error,
    detail.errorUpdatedAt,
  );
  const board = detail.data;
  const verified =
    !revoked &&
    !checking &&
    online &&
    !!board &&
    detail.isFetchedAfterMount &&
    !detail.isFetching &&
    !detail.isError &&
    data.resources.readable(boardKey);
  const writeAllowed = canMutateColumns(board);
  const columnManagement = useColumnManagement({
    boardId,
    identity,
    available: verified && focused && writeAllowed,
    discard: revoked || detail.data === null || (!!board && !writeAllowed),
    recheckBoard: () => void detail.refetch(),
  });
  const cards = useCardLifecycle({
    boardId,
    identity,
    writable: verified && focused && writeAllowed,
    discard: revoked || detail.data === null,
    discardWrites: !!board && !writeAllowed,
    recheckBoard: () => void detail.refetch(),
  });
  useEffect(() => {
    if (!revoked) return;
    setFilters({});
    setView('board');
    tableScroll.current.y = 0;
    scroll.current.x = 0;
    scroll.current.cards.clear();
    recorded.current = false;
  }, [revoked]);
  useEffect(() => {
    if (!verified || !focused || recorded.current) return;
    recorded.current = true;
    void createBoardApi(data.api, identity)
      .view(boardId, new AbortController().signal)
      .then(() => data.invalidateHints(identity, [queryKeys.home(identity)]))
      .catch(() => undefined);
  }, [boardId, data, focused, identity, verified]);

  return (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      {revoked || detail.data === null || isAccessDenied(detail.error) ? (
        <ErrorState
          title="Board unavailable"
          description="This destination is unavailable."
        />
      ) : !online || detail.isPaused ? (
        <ErrorState
          title="Connection unavailable"
          description="Reconnect to verify Board access."
        />
      ) : verified && board ? (
        <BoardContent
          boardId={boardId}
          board={board}
          identity={identity}
          focused={focused}
          filters={filters}
          onFilters={setFilters}
          scroll={scroll.current}
          view={view}
          onView={setView}
          tableScroll={tableScroll.current}
          columnManagement={columnManagement}
          cardManagement={cards}
          room={room}
        />
      ) : detail.isError && !checking && !detail.isFetching ? (
        <ErrorState
          title="Couldn’t open board"
          description={workspaceErrorMessage(detail.error)}
          action={
            <Button
              label="Retry board"
              disabled={!retryReady}
              onPress={() => void detail.refetch()}
            />
          }
        />
      ) : (
        <View style={styles.header}>
          <Skeleton width={160} height={28} label="Checking board access" />
          <Skeleton width="75%" height={24} />
          <Skeleton height={180} />
        </View>
      )}
    </SafeAreaView>
  );
}

function BoardContent({
  boardId,
  board,
  identity,
  focused,
  filters,
  onFilters,
  scroll,
  view,
  onView,
  tableScroll,
  columnManagement,
  cardManagement,
  room,
}: {
  boardId: ResourceId;
  board: KanbanBoard;
  identity: SessionIdentity;
  focused: boolean;
  filters: KanbanFilters;
  onFilters: (filters: KanbanFilters) => void;
  scroll: KanbanScroll;
  view: 'board' | 'table';
  onView: (view: 'board' | 'table') => void;
  tableScroll: { y: number };
  columnManagement: ColumnManagement;
  cardManagement: CardLifecycle;
  room: BoardRealtimeState;
}) {
  const c = useTheme();
  const router = useRouter();
  const data = useMobileData();
  const online = useWorkspaceOnline();
  const api = createKanbanApi(data.api, identity, boardId);
  const [sheet, setSheet] = useState<'filters' | 'labels' | null>(null);
  const driftRepair = useRef(false);
  const [focusedView, setFocusedView] = useState<string | null>(null);
  const workspace = useQuery({
    queryKey: [
      ...queryKeys.board(identity, boardId),
      'workspace-context',
      board.workspaceId,
    ],
    enabled: focused,
    queryFn: ({ signal }) => api.workspace(board.workspaceId, signal),
  });
  const zone = useQuery({
    ...datePreferencesOptions(data.api, identity),
    enabled: focused,
  });
  const star = useQuery({
    queryKey: boardStarKey(identity, boardId),
    enabled: focused,
    queryFn: ({ signal }) =>
      createBoardApi(data.api, identity).state(boardId, signal),
  });
  const kanban = useBoardKanban(data.api, identity, boardId, filters, focused);
  const { cards, columns, previews, cardQuery, columnQuery } = kanban;
  const refreshDueFilter = useCallback(() => {
    void cardQuery.refetch({ cancelRefetch: false });
  }, [cardQuery.refetch]);
  const catalogs = useKanbanCatalogs(
    data.api,
    identity,
    boardId,
    focused &&
      (!!sheet ||
        [...previews.byCard.values()].some(
          (summary) => summary.labelIds.length,
        )),
    focused &&
      (!!sheet || cards.items.some((card) => card.assignees.length > 0)),
  );
  const unresolvedLabels = [...previews.byCard.values()].some(({ labelIds }) =>
    labelIds.some(
      (id) => !catalogs.labelItems.some((label) => label.id === id),
    ),
  );
  useEffect(() => {
    if (
      focused &&
      unresolvedLabels &&
      catalogs.labels.hasNextPage &&
      !catalogs.labels.isFetching &&
      !catalogs.labels.isError
    ) {
      void catalogs.labels.fetchNextPage({ cancelRefetch: false });
    }
  }, [
    focused,
    unresolvedLabels,
    catalogs.labels.hasNextPage,
    catalogs.labels.isFetching,
    catalogs.labels.isError,
    catalogs.labels.fetchNextPage,
  ]);
  const count = filterCount(filters);
  const allowed = canMutateColumns(board);
  const { revealId, clearReveal } = columnManagement;
  const revealIndex = revealId
    ? columns.orderedColumnIds.indexOf(revealId)
    : -1;
  const orderReady =
    columns.complete &&
    columnQuery.isSuccess &&
    !columnQuery.isFetching &&
    !data.queryClient.getQueryState(queryKeys.columns(identity, boardId))
      ?.isInvalidated;
  useEffect(() => {
    if (
      focused &&
      cardManagement.sheet?.kind === 'archived' &&
      columnQuery.hasNextPage &&
      !columnQuery.isFetching &&
      !columnQuery.isError
    )
      void columnQuery.fetchNextPage({ cancelRefetch: false });
  }, [
    focused,
    cardManagement.sheet?.kind,
    columnQuery.hasNextPage,
    columnQuery.isFetching,
    columnQuery.isError,
    columnQuery.fetchNextPage,
  ]);
  useEffect(() => {
    if (
      !focused ||
      !online ||
      !revealId ||
      revealIndex >= 0 ||
      columnQuery.isFetching ||
      !columnQuery.isSuccess
    )
      return;
    if (columnQuery.hasNextPage)
      void columnQuery.fetchNextPage({ cancelRefetch: false });
    else if (columns.complete) clearReveal();
  }, [
    focused,
    online,
    revealId,
    revealIndex,
    columnQuery.isFetching,
    columnQuery.isSuccess,
    columnQuery.hasNextPage,
    columnQuery.fetchNextPage,
    columns.complete,
    clearReveal,
  ]);
  const columnIds = useMemo(
    () => new Set(columns.items.map((column) => column.id)),
    [columns.items],
  );
  const relationPending = [...cards.groups.keys()].some(
    (id) => !columnIds.has(id),
  );
  useEffect(() => {
    if (
      view === 'table' &&
      focused &&
      relationPending &&
      columnQuery.hasNextPage &&
      !columnQuery.isFetching &&
      !columnQuery.isError
    )
      void columnQuery.fetchNextPage({ cancelRefetch: false });
  }, [
    view,
    focused,
    relationPending,
    columnQuery.hasNextPage,
    columnQuery.isFetching,
    columnQuery.isError,
    columnQuery.fetchNextPage,
  ]);
  const complete = cards.complete && !relationPending && !cardQuery.isError;
  const mismatch = columns.complete && relationPending;
  const unstable = columns.drift || cards.drift || mismatch;
  useEffect(() => {
    if (!unstable) {
      driftRepair.current = false;
      return;
    }
    if (
      !focused ||
      !online ||
      driftRepair.current ||
      columnQuery.isFetching ||
      cardQuery.isFetching
    )
      return;
    driftRepair.current = true;
    if (columns.drift || mismatch) void columnQuery.refetch();
    if (cards.drift || mismatch) void cardQuery.refetch();
  }, [
    unstable,
    focused,
    online,
    columns.drift,
    cards.drift,
    mismatch,
    columnQuery.isFetching,
    cardQuery.isFetching,
    columnQuery.refetch,
    cardQuery.refetch,
  ]);
  const onOpen = useCallback(
    (card: KanbanCard) => {
      const cardId = parseResourceId(card.id);
      if (
        !focused ||
        !cardId ||
        card.boardId !== boardId ||
        !data.resources.readable(queryKeys.board(identity, boardId))
      )
        return;
      router.push(destinationPath({ kind: 'card', boardId, cardId }));
    },
    [boardId, data.resources, focused, identity, router],
  );

  function apply(next: KanbanFilters) {
    setSheet(null);
    const currentKey = kanbanCardOptions(
      data.api,
      identity,
      boardId,
      filters,
    ).queryKey;
    const nextKey = kanbanCardOptions(
      data.api,
      identity,
      boardId,
      next,
    ).queryKey;
    if (hashKey(currentKey) === hashKey(nextKey)) return;
    void data.queryClient.cancelQueries({ queryKey: currentKey, exact: true });
    data.queryClient.removeQueries({
      queryKey: nextKey,
      exact: true,
      type: 'inactive',
    });
    driftRepair.current = false;
    scroll.cards.clear();
    tableScroll.y = 0;
    onFilters(next);
  }
  const dueLabel = dueOptions.find(
    ([value]) => value === filters.dueStatus,
  )?.[1];
  const filteredLabels = (filters.labelIds ?? [])
    .map((id) => catalogs.labelItems.find((label) => label.id === id)?.name)
    .filter(Boolean);
  const cardState =
    cards.drift || mismatch
      ? 'Card positions changed while loading.'
      : undefined;
  const columnState = columns.drift
    ? 'Columns changed while loading.'
    : undefined;
  const previewUnavailable =
    filters.status !== 'archived' &&
    (previews.failures.length > 0 ||
      (!previews.loading &&
        cards.items.some((card) => !previews.byCard.has(card.id))));
  const cardRetryReady = useWorkspaceRetryReady(
    cardQuery.error,
    cardQuery.errorUpdatedAt,
  );
  const columnRetryReady = useWorkspaceRetryReady(
    columnQuery.error,
    columnQuery.errorUpdatedAt,
  );
  const previewError = previews.failures[0];
  const previewRetryReady = useWorkspaceRetryReady(
    previewError?.error,
    previewError?.errorUpdatedAt ?? 0,
  );

  const header = (
    <View style={styles.header}>
      <AppHeader
        trailing={
          <View style={{ flexDirection: 'row' }}>
            {star.data && !star.isError && (
              <BoardStar
                identity={identity}
                id={boardId}
                name={board.name}
                starred={star.data.isStarred}
                updatedAt={star.dataUpdatedAt}
                disabled={!online}
              />
            )}
            <Button
              variant="icon"
              label="Board actions"
              onPress={() => cardManagement.open({ kind: 'board' })}
              icon={
                <Text style={[typography.section, { color: c.text }]}>⋯</Text>
              }
            />
          </View>
        }
      />
      <View style={styles.boardHeading}>
        <BoardArtwork preset={board.backgroundPreset ?? ''} />
        <View style={{ flex: 1 }}>
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            style={[typography.title, { color: c.text }]}
          >
            {board.name}
          </Text>
          <Text
            numberOfLines={1}
            style={[typography.supporting, { color: c.textSecondary }]}
          >
            {workspace.data ??
              (workspace.isFetching
                ? 'Loading workspace…'
                : 'Workspace details unavailable')}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <BoardPresence
            identity={identity}
            boardId={boardId}
            room={room}
            boardReadable={
              focused &&
              board.capabilities.canReadBoard &&
              data.resources.readable(queryKeys.board(identity, boardId))
            }
            explicitMember={board.currentUserRole !== null}
          />
          {!allowed && (
            <StatusChip
              label={board.isArchived ? 'Archived · Read-only' : 'Read-only'}
              tone="info"
            />
          )}
          <Button
            label="Board settings"
            variant="link"
            disabled={!focused}
            onPress={() => {
              if (
                focused &&
                data.resources.readable(queryKeys.board(identity, boardId))
              )
                router.push(
                  destinationPath({ kind: 'boardSettings', boardId }),
                );
            }}
          />
          {board.currentUserRole && (
            <Button
              label="Board members"
              variant="link"
              disabled={!focused}
              onPress={() => {
                if (
                  focused &&
                  data.resources.readable(queryKeys.board(identity, boardId))
                )
                  router.push(
                    destinationPath({ kind: 'boardMembers', boardId }),
                  );
              }}
            />
          )}
        </View>
      </View>
      {view === 'board' &&
        columnManagement.available &&
        (columns.items.length > 0 || !columns.complete) && (
          <View style={styles.badge}>
            <Button
              label="Add column"
              variant="link"
              disabled={columnManagement.pending}
              onPress={columnManagement.openCreate}
            />
          </View>
        )}
      <View
        style={[styles.views, { borderBottomColor: c.border }]}
        accessibilityRole="tablist"
      >
        {(['board', 'table'] as const).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityLabel={item === 'board' ? 'Board' : 'Table'}
            accessibilityState={{ selected: view === item }}
            onPress={() => onView(item)}
            onFocus={() => setFocusedView(item)}
            onBlur={() => setFocusedView(null)}
            style={({ pressed }) => ({
              minHeight: 48,
              minWidth: 48,
              justifyContent: 'center',
              borderBottomWidth: 2,
              borderBottomColor: view === item ? c.primary : 'transparent',
              backgroundColor:
                pressed || focusedView === item ? c.primaryTint : 'transparent',
            })}
          >
            <Text
              style={[
                typography.strong,
                { color: view === item ? c.primary : c.textSecondary },
              ]}
            >
              {item === 'board' ? 'Board' : 'Table'}
            </Text>
          </Pressable>
        ))}
        <Button
          label="Calendar"
          variant="link"
          disabled={!focused}
          onPress={() => {
            if (
              focused &&
              data.resources.readable(queryKeys.board(identity, boardId))
            )
              router.push(
                destinationPath({
                  kind: 'boardView',
                  boardId,
                  view: 'calendar',
                }),
              );
          }}
        />
      </View>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ alignItems: 'center', gap: spacing.sm }}
      >
        <FilterChip
          label={count ? `Filters (${count})` : 'Filters'}
          onPress={() => setSheet('filters')}
        />
        <FilterChip label="All" selected={!count} onPress={() => apply({})} />
        {board.currentUserRole && (
          <FilterChip
            label="Mine"
            selected={filters.assigneeIds?.includes(identity.userId) ?? false}
            onPress={() =>
              apply({
                ...filters,
                assigneeIds: filters.assigneeIds?.includes(identity.userId)
                  ? filters.assigneeIds.filter((id) => id !== identity.userId)
                  : [identity.userId],
              })
            }
          />
        )}
        <FilterChip
          label={dueLabel ?? 'Due today'}
          selected={!!filters.dueStatus}
          onPress={() =>
            apply({
              ...filters,
              dueStatus: filters.dueStatus ? undefined : 'DUE_TODAY',
            })
          }
        />
        <FilterChip
          label={
            filteredLabels.length
              ? filteredLabels.join(', ')
              : filters.labelIds?.length
                ? `Labels (${filters.labelIds.length})`
                : 'Labels'
          }
          selected={!!filters.labelIds?.length}
          onPress={() => setSheet('labels')}
        />
        {!!filters.q && (
          <FilterChip
            label={`Search: ${filters.q.slice(0, 32)}`}
            selected
            onPress={() => setSheet('filters')}
          />
        )}
        {count > 0 && (
          <FilterChip label="Clear filters" onPress={() => apply({})} />
        )}
      </ScrollView>
      {view === 'table' && (
        <View style={{ alignItems: 'flex-start' }}>
          <Button
            label={`Sort: ${!filters.sortBy ? 'Board order' : filters.sortBy === 'title' ? (filters.sortDirection === 'desc' ? 'Title Z–A' : 'Title A–Z') : filters.sortDirection === 'desc' ? 'Latest due date' : 'Earliest due date'}`}
            variant="link"
            onPress={() => setSheet('filters')}
          />
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.caption, { color: c.textSecondary }]}
          >
            {filters.sortBy
              ? 'Server order · all matching cards'
              : 'Default server order · column and card position'}
          </Text>
        </View>
      )}
    </View>
  );
  const footer = (
    <View style={[styles.footer, { borderTopColor: c.border }]}>
      {!!cardManagement.notice && !cardManagement.sheet && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.supporting, { color: c.text }]}
        >
          {cardManagement.notice}
        </Text>
      )}
      {cards.total !== undefined && (
        <Text
          style={[typography.supporting, { color: c.textSecondary }]}
          accessibilityLiveRegion="polite"
        >
          {complete
            ? cards.total === 0 && count
              ? 'No cards match these filters.'
              : `${cards.total} ${cards.total === 1 ? 'card' : 'cards'}`
            : `Loaded ${cards.items.length} of ${cards.total} cards`}
        </Text>
      )}
      {columns.hasMore && (
        <Text style={[typography.caption, { color: c.textSecondary }]}>
          {columns.items.length} of {columns.total} columns loaded
        </Text>
      )}
      {cards.total === undefined && !cardQuery.isError && (
        <Text style={[typography.supporting, { color: c.textSecondary }]}>
          Loading cards…
        </Text>
      )}
      {(columnQuery.isError ||
        cardQuery.isError ||
        columnState ||
        cardState) && (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.supporting, { color: c.textSecondary }]}
        >
          {columnState ??
            cardState ??
            ((isAccessDenied(cardQuery.error) ||
              (cardQuery.error instanceof ApiError &&
                cardQuery.error.code === 'RESOURCE_ACCESS_CHANGED')) &&
            count
              ? 'A filter may no longer be available. Clear filters or retry.'
              : workspaceErrorMessage(columnQuery.error ?? cardQuery.error))}
        </Text>
      )}
      <View style={styles.actions}>
        {(columnQuery.isError || columnState || columns.hasMore) && (
          <Button
            label={
              columnState
                ? 'Refresh columns'
                : columnQuery.isError
                  ? 'Retry columns'
                  : 'Load more columns'
            }
            variant="link"
            loading={columnQuery.isFetchingNextPage}
            disabled={!online || !columnRetryReady || columnQuery.isFetching}
            onPress={() =>
              void (columnState ||
              (columnQuery.isError && !columnQuery.isFetchNextPageError)
                ? columnQuery.refetch()
                : columnQuery.fetchNextPage({ cancelRefetch: false }))
            }
          />
        )}
        {(cardQuery.isError || cardState || cards.hasMore) && (
          <Button
            label={
              cardState
                ? 'Refresh cards'
                : cardQuery.isError
                  ? 'Retry cards'
                  : 'Load more cards'
            }
            variant="link"
            loading={cardQuery.isFetchingNextPage}
            disabled={!online || !cardRetryReady || cardQuery.isFetching}
            onPress={() => {
              if (mismatch) void columnQuery.refetch();
              void (cardState ||
              (cardQuery.isError && !cardQuery.isFetchNextPageError)
                ? cardQuery.refetch()
                : cardQuery.fetchNextPage({ cancelRefetch: false }));
            }}
          />
        )}
        {previewUnavailable && (
          <Button
            label="Retry card summaries"
            variant="link"
            disabled={!online || !previewRetryReady}
            onPress={() =>
              void data
                .invalidate(identity, [
                  [...queryKeys.board(identity, boardId), 'previews'],
                ])
                .catch(() => undefined)
            }
          />
        )}
      </View>
      {previewUnavailable && (
        <Text style={[typography.caption, { color: c.textSecondary }]}>
          Some card summaries are unavailable.
        </Text>
      )}
    </View>
  );

  return (
    <>
      {view === 'table' ? (
        <BoardTable
          key={hashKey([normalizeKanbanFilters(filters)])}
          cards={cards.items}
          columns={columns.items}
          previews={previews.byCard}
          labels={catalogs.labelItems}
          members={catalogs.memberItems}
          preferences={zone.data}
          active={focused}
          onDueBoundary={filters.dueStatus ? refreshDueFilter : undefined}
          ready={cards.total !== undefined}
          complete={complete}
          loading={cardQuery.isFetching}
          scroll={tableScroll}
          header={header}
          footer={footer}
          onOpen={onOpen}
          onActions={
            cardManagement.writable
              ? (card) => cardManagement.open({ kind: 'actions', card })
              : undefined
          }
          actionsDisabled={cardManagement.pending}
        />
      ) : (
        <>
          {header}
          {columns.items.length === 0 && columns.complete ? (
            <EmptyState
              title="No columns yet"
              description={
                allowed ? undefined : 'This board has no columns to display.'
              }
              action={
                columnManagement.available ? (
                  <Button
                    label="Add column"
                    disabled={columnManagement.pending}
                    onPress={columnManagement.openCreate}
                  />
                ) : undefined
              }
            />
          ) : columns.items.length > 0 ? (
            <BoardKanban
              key={hashKey([normalizeKanbanFilters(filters)])}
              columns={columns.items}
              columnsComplete={columns.complete && !columnQuery.isFetching}
              groups={cards.groups}
              cardsReady={cards.total !== undefined}
              cardsComplete={complete}
              cardsLoading={cardQuery.isFetching}
              previews={previews.byCard}
              labels={catalogs.labelItems}
              members={catalogs.memberItems}
              timeZone={zone.data?.timeZone}
              scroll={scroll}
              onOpen={onOpen}
              onAddCard={
                cardManagement.writable && filters.status !== 'archived'
                  ? (column) => cardManagement.open({ kind: 'create', column })
                  : undefined
              }
              onCardActions={
                cardManagement.writable
                  ? (card) => cardManagement.open({ kind: 'actions', card })
                  : undefined
              }
              cardActionsDisabled={cardManagement.pending}
              onColumnActions={
                columnManagement.available
                  ? columnManagement.openActions
                  : undefined
              }
              columnActionsDisabled={columnManagement.pending}
              revealColumnIndex={revealIndex}
              onColumnRevealed={clearReveal}
            />
          ) : !columnQuery.isError ? (
            <View style={[styles.header, { flex: 1 }]}>
              <Skeleton height={160} label="Loading columns" />
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          {footer}
        </>
      )}
      {sheet && focused && (
        <BoardFiltersSheet
          initial={filters}
          startWithLabels={sheet === 'labels'}
          catalogs={catalogs}
          timeZone={zone.data?.timeZone}
          online={online}
          onCancel={() => setSheet(null)}
          onApply={apply}
        />
      )}
      {columnManagement.sheet && (
        <ColumnActionsSheet
          management={columnManagement}
          orderedColumnIds={columns.orderedColumnIds}
          orderReady={orderReady}
        />
      )}
      {focused && cardManagement.sheet && (
        <CardActionsSheet
          management={cardManagement}
          identity={identity}
          boardId={boardId}
          columns={columns.items}
          allowPrecision={count === 0 && !unstable}
          columnsPending={columnQuery.isFetching}
          onLoadColumns={
            columnQuery.hasNextPage
              ? () => void columnQuery.fetchNextPage({ cancelRefetch: false })
              : undefined
          }
          onOpenCard={(card) => {
            onOpen(card);
            cardManagement.close();
          }}
          refreshBoardForReview={async () => {
            const options = kanbanCardOptions(data.api, identity, boardId, {});
            apply({});
            await data.queryClient.cancelQueries({
              queryKey: options.queryKey,
              exact: true,
            });
            return data.queryClient.fetchInfiniteQuery({
              ...options,
              retry: false,
            });
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  boardHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: { alignSelf: 'flex-start' },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  views: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.lg,
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
});
