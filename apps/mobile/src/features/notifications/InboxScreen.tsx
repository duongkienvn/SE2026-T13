import type { NotificationResponse } from '@kanban/shared';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { ApiError } from '../../infrastructure/api/errors';
import { TabHeader } from '../../navigation/scaffold';
import {
  Button,
  FilterChip,
  Skeleton,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { compactUnread } from './grouping';
import { InboxSections } from './InboxSections';
import { inboxRows } from './queries';
import { useInbox } from './useInbox';
import { verifyNotificationDestination } from './navigation';
import { inboxErrorMessage } from './status';
export function InboxScreen() {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated') return null;
  return (
    <Inbox
      key={session.user.id + ':' + session.generation}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}
function Inbox({ identity }: { identity: SessionIdentity }) {
  const c = useTheme(),
    data = useMobileData(),
    router = useRouter();
  const inbox = useInbox(identity);
  const { list, unread, mutation, eligible, online, commands } = inbox;
  const [notice, setNotice] = useState(''),
    [opening, setOpening] = useState<string>();
  const navigation = useRef<AbortController | null>(null),
    paging = useRef(false);
  const error = list.error instanceof ApiError ? list.error : null;
  const denied =
    error?.kind === 'session-changed' ||
    error?.kind === 'unauthenticated' ||
    [401, 403].includes(error?.status ?? 0);
  const usable =
    eligible &&
    !mutation.mustReview &&
    !inbox.changed &&
    !denied &&
    list.isFetchedAfterMount &&
    !list.isRefetching &&
    (!list.isError || list.isFetchNextPageError);
  const rows = inboxRows(usable ? (list.data?.pages ?? []) : []);
  const count =
    eligible &&
    !mutation.mustReview &&
    unread.isFetchedAfterMount &&
    !unread.isError &&
    !unread.isRefetching
      ? unread.data
      : undefined;
  const canRefresh =
    eligible &&
    !mutation.pending &&
    inbox.listReady &&
    inbox.countReady &&
    !list.isFetching &&
    !unread.isFetching;
  function cancelOpen() {
    navigation.current?.abort();
    navigation.current = null;
    setOpening(undefined);
  }
  useEffect(() => {
    if (!eligible) cancelOpen();
    return () => navigation.current?.abort();
  }, [eligible]);
  async function refresh() {
    if (!canRefresh) return;
    cancelOpen();
    setNotice('');
    try {
      if (mutation.mustReview) await commands.review(inbox.filter);
      else
        await Promise.all([
          data.queryClient.resetQueries({
            queryKey: inbox.options.queryKey,
            exact: true,
          }),
          unread.refetch({ cancelRefetch: false }),
        ]);
    } catch {
      /* Query/command stores expose safe recovery state. */
    }
  }
  async function loadMore() {
    if (
      !usable ||
      !eligible ||
      mutation.pending ||
      !inbox.listReady ||
      !list.hasNextPage ||
      list.isFetching ||
      paging.current
    )
      return;
    paging.current = true;
    try {
      await list.fetchNextPage({ cancelRefetch: false });
    } finally {
      paging.current = false;
    }
  }
  async function open(item: NotificationResponse) {
    if (
      !usable ||
      navigation.current ||
      mutation.pending ||
      mutation.mustReview
    )
      return;
    const source = list.data?.pages
      .filter((page) => page.data.some(({ id }) => id === item.id))
      .at(-1);
    if (!source) return;
    const controller = new AbortController();
    navigation.current = controller;
    setOpening(item.id);
    setNotice('');
    const snapshot = list.data;
    try {
      const path = await verifyNotificationDestination(
        data,
        identity,
        item,
        { filter: inbox.filter, page: source.meta.page },
        controller.signal,
      );
      if (
        !controller.signal.aborted &&
        sameIdentity(identity, data.getIdentity())
      ) {
        if (data.queryClient.getQueryData(inbox.options.queryKey) === snapshot)
          router.navigate(path);
        else setNotice('Your Inbox changed. Open the notification again.');
      }
    } catch {
      if (
        !controller.signal.aborted &&
        sameIdentity(identity, data.getIdentity())
      )
        setNotice(
          'This notification cannot be opened right now. Refresh your Inbox to check what’s available.',
        );
    } finally {
      if (navigation.current === controller) {
        navigation.current = null;
        setOpening(undefined);
      }
    }
  }
  const message = !online
    ? 'You’re offline. Reconnect to refresh your Inbox.'
    : mutation.mustReview
      ? 'Read status wasn’t confirmed. Review the Inbox before trying again.'
      : list.isError
        ? list.isFetchNextPageError
          ? 'Couldn’t load the next page. Your loaded notifications are below.'
          : inboxErrorMessage(list.error)
        : !inbox.listReady
          ? 'Too many requests. Wait before trying again.'
          : '';
  const disabled =
    !usable ||
    !!mutation.pending ||
    mutation.mustReview ||
    !inbox.writesReady ||
    !!opening ||
    list.isFetching;
  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      <ScrollView
        testID="inbox-scroll"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching}
            onRefresh={() => void refresh()}
            tintColor={c.primary}
          />
        }
      >
        <TabHeader search={false} />
        <View style={{ gap: spacing.xs }}>
          <Text
            accessibilityRole="header"
            style={[typography.display, { color: c.text }]}
          >
            Inbox
          </Text>
          <Text style={[typography.body, { color: c.textSecondary }]}>
            Updates from your boards, tasks, and team.
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: spacing.sm,
          }}
        >
          <FilterChip
            label="All"
            selected={inbox.filter === 'all'}
            disabled={!!mutation.pending}
            onPress={() => {
              cancelOpen();
              setNotice('');
              inbox.changeFilter('all');
            }}
          />
          <FilterChip
            label={
              'Unread' +
              (count === undefined ? '' : ' · ' + compactUnread(count))
            }
            accessibilityLabel={
              count === undefined
                ? 'Unread'
                : `Unread, ${count} unread notifications`
            }
            selected={inbox.filter === 'unread'}
            disabled={!!mutation.pending}
            onPress={() => {
              cancelOpen();
              setNotice('');
              inbox.changeFilter('unread');
            }}
          />
          <Button
            label="Mark all as read"
            variant="secondary"
            loading={mutation.pending === 'all'}
            disabled={
              !eligible ||
              !count ||
              !!mutation.pending ||
              mutation.mustReview ||
              !inbox.writesReady ||
              !!opening
            }
            onPress={() => {
              cancelOpen();
              void commands.readAll().catch(() => undefined);
            }}
          />
        </View>
        <Text style={[typography.supporting, { color: c.textSecondary }]}>
          Dates in {inbox.dates.timeZone}
        </Text>
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
                mutation.mustReview
                  ? 'Review Inbox'
                  : list.isFetchNextPageError
                    ? 'Retry load more'
                    : 'Retry Inbox'
              }
              disabled={
                list.isFetchNextPageError
                  ? !eligible || !inbox.listReady || !!mutation.pending
                  : !canRefresh
              }
              loading={mutation.pending === 'review'}
              onPress={
                list.isFetchNextPageError && !mutation.mustReview
                  ? () => void loadMore()
                  : () => void refresh()
              }
            />
          </View>
        )}
        {!!mutation.error && !mutation.mustReview && (
          <Text accessibilityLiveRegion="polite" style={{ color: c.text }}>
            {inboxErrorMessage(mutation.error)}
          </Text>
        )}
        {!!notice && (
          <View style={{ gap: spacing.sm }}>
            <Text accessibilityLiveRegion="polite" style={{ color: c.text }}>
              {notice}
            </Text>
            <Button
              label="Refresh Inbox"
              disabled={!canRefresh}
              onPress={() => void refresh()}
            />
          </View>
        )}
        {unread.isError && !mutation.mustReview && (
          <View style={{ gap: spacing.sm }}>
            <Text accessibilityLiveRegion="polite" style={{ color: c.text }}>
              Unread count unavailable. {inboxErrorMessage(unread.error)}
            </Text>
            <Button
              label="Retry unread count"
              disabled={
                !eligible ||
                !inbox.countReady ||
                !!mutation.pending ||
                unread.isFetching
              }
              onPress={() => {
                void unread.refetch({ cancelRefetch: false });
              }}
            />
          </View>
        )}
        {list.isFetching && !list.isFetchingNextPage && (
          <View testID="inbox-skeleton" style={{ gap: spacing.sm }}>
            <Skeleton height={70} />
            <Skeleton height={70} />
            <Skeleton height={70} />
          </View>
        )}
        {usable && !rows.length && !!list.data && (
          <View style={{ gap: spacing.sm }}>
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.textSecondary }]}
            >
              {inbox.filter === 'all'
                ? 'No notifications yet.'
                : 'No unread notifications.'}
            </Text>
            <Button
              label="Refresh Inbox"
              disabled={!canRefresh}
              onPress={() => void refresh()}
            />
          </View>
        )}
        <InboxSections
          rows={rows}
          preferences={inbox.dates}
          now={inbox.now}
          disabled={disabled}
          pending={mutation.pending}
          opening={opening}
          onOpen={(item) => void open(item)}
          onRead={(item) => {
            cancelOpen();
            void commands.read(item.id).catch(() => undefined);
          }}
        />
        {usable && list.hasNextPage && !list.isFetchNextPageError && (
          <Button
            label="Load more notifications"
            loading={list.isFetchingNextPage}
            disabled={!inbox.listReady || !!mutation.pending}
            onPress={() => void loadMore()}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
