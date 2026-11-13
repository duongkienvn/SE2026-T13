import { useIsFocused, useRouter } from 'expo-router';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { focusManager, onlineManager, useQuery } from '@tanstack/react-query';
import { ApiError } from '../../infrastructure/api/errors';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import type { SessionUser } from '../../infrastructure/auth/session-api';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { TabHeader } from '../../navigation/scaffold';
import type { DestinationPath } from '../../navigation/routes';
import { Button, radius, sizes, spacing, typography, useTheme } from '../../ui';
import {
  boardsPath,
  boardPath,
  cardPath,
  greeting,
  tasksPath,
} from './presentation';
import { homeOptions } from './query';
import {
  BoardCollection,
  HomeHeading,
  HomeSkeleton,
  SummaryTiles,
  UpNext,
} from './sections';

const subscribeOnline = onlineManager.subscribe.bind(onlineManager);
const isOnline = () => onlineManager.isOnline();
const subscribeFocus = focusManager.subscribe.bind(focusManager);
const isForeground = () => focusManager.isFocused();

export function HomeScreen() {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated') return null;
  return (
    <VerifiedHome
      key={`${session.generation}:${session.user.id}`}
      identity={{ userId: session.user.id, generation: session.generation }}
      user={session.user}
    />
  );
}

function VerifiedHome({
  identity,
  user,
}: {
  identity: SessionIdentity;
  user: SessionUser;
}) {
  const data = useMobileData();
  const focused = useIsFocused();
  const online = useSyncExternalStore(subscribeOnline, isOnline);
  const foreground = useSyncExternalStore(subscribeFocus, isForeground);
  const now = useHomeClock(focused && foreground);
  const router = useRouter();
  const c = useTheme();
  const options = homeOptions(data, identity);
  const query = useQuery({ ...options, enabled: focused });
  const lastManualRefresh = useRef(-Infinity);
  const [waiting, setWaiting] = useState(false);
  const error = query.error instanceof ApiError ? query.error : null;
  const retryAt =
    error?.status === 429 && error.retryAfterMs
      ? query.errorUpdatedAt + error.retryAfterMs
      : 0;

  useEffect(() => {
    const delay = retryAt - Date.now();
    setWaiting(delay > 0);
    if (delay <= 0) return;
    const timer = setTimeout(
      () => setWaiting(false),
      Math.min(delay, 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [retryAt, foreground]);

  const refresh = () => {
    const time = Date.now();
    if (
      !focused ||
      !isOnline() ||
      !sameIdentity(identity, data.getIdentity()) ||
      time < retryAt ||
      time - lastManualRefresh.current < 1000 ||
      data.queryClient.isFetching({ queryKey: options.queryKey, exact: true })
    )
      return;
    lastManualRefresh.current = time;
    void query.refetch({ cancelRefetch: false });
  };

  // Keep old data only for recoverable failures while this session still owns it.
  const accessChanged =
    error?.kind === 'session-changed' ||
    error?.kind === 'unauthenticated' ||
    [401, 403, 404].includes(error?.status ?? 0);
  const dashboard = accessChanged ? undefined : query.data;
  const offline = !online || query.isPaused || error?.kind === 'offline';
  const loading =
    !dashboard && !offline && (!query.isError || query.isFetching);
  const go = (path: DestinationPath | null, privatePreview = false) => {
    if (!path || !sameIdentity(identity, data.getIdentity())) return;
    // A tap queued before eviction/reconciliation must not open a stale preview.
    if (
      privatePreview &&
      (!dashboard ||
        data.queryClient.getQueryData(options.queryKey) !== dashboard)
    )
      return;
    router.navigate(path);
  };
  const tasks = () => go(tasksPath);
  const boards = () => go(boardsPath);
  const notice = offline
    ? dashboard
      ? 'Offline. Showing the last available Home.'
      : 'You’re offline. Home will reload when you reconnect.'
    : query.isError && !loading
      ? homeErrorMessage(error, !!dashboard)
      : null;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: c.background }}
      edges={['top', 'left', 'right']}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            testID="home-refresh"
            refreshing={query.isRefetching}
            onRefresh={refresh}
            tintColor={c.primary}
            colors={[c.focus]}
            progressBackgroundColor={c.surface}
          />
        }
      >
        <TabHeader
          search
          avatar={<HomeAvatar key={user.avatarUrl} user={user} />}
        />
        <View style={{ gap: spacing.xs }}>
          <Text
            accessibilityRole="header"
            style={[typography.display, { color: c.text }]}
          >
            {greeting(user.displayName, now)}
          </Text>
          <Text style={[typography.body, { color: c.textSecondary }]}>
            Here’s what needs your attention.
          </Text>
        </View>
        {notice && (
          <View
            style={[
              styles.notice,
              { backgroundColor: c.surfaceSoft, borderColor: c.border },
            ]}
          >
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.text }]}
            >
              {notice}
            </Text>
            {!offline && (
              <Button
                label="Retry"
                variant="link"
                onPress={refresh}
                disabled={waiting || query.isFetching}
              />
            )}
          </View>
        )}
        {loading && <HomeSkeleton />}
        {dashboard && (
          <>
            <SummaryTiles summary={dashboard.summary} openTasks={tasks} />
            <View>
              <HomeHeading title="Up next" action="View all" onPress={tasks} />
              <UpNext
                tasks={dashboard.upNext}
                now={now}
                openCard={(task) => go(cardPath(task), true)}
              />
            </View>
            <View style={{ gap: spacing.sm }}>
              <HomeHeading
                title="Your boards"
                action="See all"
                onPress={boards}
              />
              <BoardCollection
                kind="starred"
                boards={dashboard.starredBoards}
                openBoard={(board) => go(boardPath(board), true)}
              />
              <BoardCollection
                kind="recent"
                boards={dashboard.recentBoards}
                openBoard={(board) => go(boardPath(board), true)}
              />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function homeErrorMessage(error: ApiError | null, cached: boolean) {
  if (
    error?.code === 'RESOURCE_ACCESS_CHANGED' ||
    [403, 404].includes(error?.status ?? 0)
  )
    return 'Home access may have changed. Retry to check for available items.';
  if (error?.status === 429) return 'Too many requests. Try again shortly.';
  if (error?.kind === 'timeout')
    return 'Home took too long to load. Please retry.';
  return cached
    ? 'Couldn’t refresh Home. Showing the last available data.'
    : 'Home is unavailable right now. Please retry.';
}

function HomeAvatar({ user }: { user: SessionUser }) {
  const c = useTheme();
  const [failed, setFailed] = useState(false);
  const initials = user.displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase();
  const photo = user.avatarUrl;
  // The verified profile can supply a signed or external HTTPS avatar.
  // Never attach credentials or load local/file/cleartext sources.
  return photo && /^https:\/\/[^/\s]+/i.test(photo) && !failed ? (
    <Image
      source={{ uri: photo }}
      style={styles.avatar}
      onError={() => setFailed(true)}
    />
  ) : (
    <Text
      allowFontScaling={false}
      style={[typography.caption, { color: c.text }]}
    >
      {initials || 'K'}
    </Text>
  );
}

function useHomeClock(active: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

const styles = StyleSheet.create({
  scroll: {
    width: '100%',
    maxWidth: sizes.contentMax,
    alignSelf: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  notice: {
    padding: spacing.md,
    borderRadius: radius.control,
    borderWidth: 1,
    alignItems: 'flex-start',
  },
  avatar: { width: 36, height: 36, borderRadius: radius.pill },
});
