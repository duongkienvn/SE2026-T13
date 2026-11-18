import type { ApiPaginatedResponse } from '@kanban/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { sameIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import type { PrivateQueryKey } from '../../infrastructure/query/keys';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  Skeleton,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import {
  useWorkspaceRetryReady,
  canRetryWorkspace,
  workspaceErrorMessage,
} from '../workspaces/status';
import {
  describeCardDate,
  utcPreferences,
  type DatePreferences,
} from '../cards/metadata/dates';
import { activityTime } from './time';
import { verifyActivityTarget, type ActivityTarget } from './navigation';

export type TimelineItem = {
  id: string;
  actor: string;
  action: string;
  context?: string;
  createdAt: string;
  target?: ActivityTarget;
};
export type ActivityPage<T> = ApiPaginatedResponse<T> & {
  name: string;
  archived: boolean;
  permissionScope: string;
};

export function Timeline<T>({
  query,
  title,
  page,
  setPage,
  present,
  preferences,
  preferencesReady,
  active,
  online,
  identity,
  source,
}: {
  query: UseQueryResult<ActivityPage<T>>;
  title: string;
  page: number;
  setPage(page: number): void;
  present(row: T): TimelineItem;
  preferences?: DatePreferences;
  preferencesReady: boolean;
  active: boolean;
  online: boolean;
  identity: SessionIdentity;
  source: PrivateQueryKey;
}) {
  const c = useTheme();
  const data = useMobileData();
  const router = useRouter();
  const list = useRef<FlatList<TimelineItem>>(null);
  const navigation = useRef<AbortController | null>(null);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now);
  const ready = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  const result = query.isFetchedAfterMount ? query.data : undefined;
  const lastPage = result ? Math.max(1, result.meta.totalPages) : page;
  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [page, lastPage, setPage]);
  useEffect(() => {
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [page]);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    navigation.current?.abort();
    navigation.current = null;
    setOpening(false);
    setNotice('');
    return () => {
      navigation.current?.abort();
    };
  }, [active, page, result]);

  async function open(target: ActivityTarget) {
    if (
      !active ||
      !online ||
      navigation.current ||
      !data.resources.readable(source)
    )
      return;
    const controller = new AbortController();
    navigation.current = controller;
    setOpening(true);
    setNotice('');
    try {
      const path = await verifyActivityTarget(
        data,
        identity,
        source,
        target,
        controller.signal,
      );
      if (
        !controller.signal.aborted &&
        sameIdentity(identity, data.getIdentity())
      )
        router.push(path);
    } catch {
      if (
        !controller.signal.aborted &&
        sameIdentity(identity, data.getIdentity())
      )
        setNotice(
          'Item unavailable. Refresh activity to check what’s available.',
        );
    } finally {
      if (navigation.current === controller) {
        navigation.current = null;
        setOpening(false);
      }
    }
  }
  const retry = () => {
    if (
      active &&
      online &&
      !query.isFetching &&
      canRetryWorkspace(query.error, query.errorUpdatedAt)
    )
      void query.refetch({ cancelRefetch: false });
  };
  const items = result && page <= lastPage ? result.data.map(present) : [];
  return (
    <FlatList
      ref={list}
      data={items}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        padding: spacing.xl,
        gap: spacing.md,
        flexGrow: 1,
      }}
      initialNumToRender={10}
      maxToRenderPerBatch={10}
      windowSize={5}
      ListHeaderComponent={
        <View style={{ gap: spacing.sm }}>
          <Text
            accessibilityRole="header"
            style={[typography.title, { color: c.text }]}
          >
            {title}
          </Text>
          {result && (
            <Text style={[typography.body, { color: c.textSecondary }]}>
              {result.name}
            </Text>
          )}
          <Text style={[typography.supporting, { color: c.textSecondary }]}>
            {result?.archived
              ? 'Archived board · Read only · Newest first'
              : 'Read only · Newest first'}
          </Text>
          {!online && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.textSecondary }]}
            >
              You’re offline. Reconnect to refresh activity.
            </Text>
          )}
          {query.isError && (
            <ErrorState
              title="Couldn’t refresh activity"
              description={workspaceErrorMessage(query.error)}
              action={
                <Button
                  label="Retry activity"
                  variant="secondary"
                  disabled={!active || !online || !ready || query.isFetching}
                  onPress={retry}
                />
              }
            />
          )}
          {query.isFetching && result && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.supporting, { color: c.textSecondary }]}
            >
              Refreshing activity…
            </Text>
          )}
          {!!notice && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.textSecondary }]}
            >
              {notice}
            </Text>
          )}
          {opening && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.textSecondary }]}
            >
              Checking item access…
            </Text>
          )}
        </View>
      }
      ListEmptyComponent={
        !result && !query.isError && online ? (
          <View style={{ gap: spacing.lg }}>
            {[1, 2, 3].map((n) => (
              <View key={n} style={{ gap: spacing.sm }}>
                <Skeleton height={20} label="Loading activity" />
                <Skeleton width="60%" />
              </View>
            ))}
          </View>
        ) : result && page <= lastPage ? (
          <EmptyState
            title="No activity yet"
            description="Activity will appear when changes happen in this scope."
          />
        ) : undefined
      }
      renderItem={({ item, index }) => {
        const time = activityTime(
          item.createdAt,
          preferences ?? utcPreferences,
          now,
        );
        const exact = time.exact;
        const short = preferences
          ? describeCardDate(item.createdAt, preferences).short
          : item.createdAt;
        const timestamp =
          time.relative === short ? short : `${time.relative} · ${short}`;
        const summary = `${item.actor} ${item.action}`;
        const context = item.context ? `${item.context}\n` : '';
        return (
          <View
            accessible={!item.target}
            accessibilityLabel={`${(page - 1) * 20 + index + 1}. ${summary}. ${item.context ?? ''}. ${exact}`}
          >
            <ListRow
              title={summary}
              subtitle={`${context}${timestamp}`}
              leading={<Avatar name={item.actor} size={32} />}
              accessibilityLabel={`Open ${item.target?.kind === 'board' ? 'board' : 'card'}. ${(page - 1) * 20 + index + 1}. ${summary}. ${item.context ?? ''}. ${exact}`}
              disabled={
                !!item.target &&
                (!active || !online || opening || query.isFetching)
              }
              onPress={item.target ? () => void open(item.target!) : undefined}
            />
          </View>
        );
      }}
      ListFooterComponent={
        <View style={{ gap: spacing.sm }}>
          {result && (
            <Text
              accessibilityLiveRegion="polite"
              style={[
                typography.supporting,
                typography.numeric,
                { color: c.textSecondary },
              ]}
            >
              {result.meta.total} events · Page {Math.min(page, lastPage)} of{' '}
              {lastPage}
            </Text>
          )}
          {!preferencesReady && (
            <Text style={[typography.supporting, { color: c.textSecondary }]}>
              Until date preferences are available, timestamps use UTC.
            </Text>
          )}
          {page > 1 && (
            <Button
              label="Newer activity"
              variant="secondary"
              disabled={
                !active || !online || !ready || query.isFetching || opening
              }
              onPress={() => setPage(page - 1)}
            />
          )}
          {result && page < lastPage && (
            <Button
              label="Older activity"
              variant="secondary"
              disabled={
                !active || !online || !ready || query.isFetching || opening
              }
              onPress={() => setPage(page + 1)}
            />
          )}
          <Button
            label="Refresh activity"
            variant="link"
            loading={query.isFetching}
            disabled={!active || !online || !ready || opening}
            onPress={retry}
          />
        </View>
      }
    />
  );
}
