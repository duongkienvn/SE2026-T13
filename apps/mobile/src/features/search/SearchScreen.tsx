import type { GlobalSearchItem } from '@kanban/shared';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../../infrastructure/api/errors';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client';
import { useSessionSnapshot } from '../../infrastructure/auth/SessionProvider';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import {
  AppHeader,
  Button,
  FilterChip,
  SearchField,
  Skeleton,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { searchGroups, searchTypes } from './input';
import { verifySearchDestination } from './navigation';
import { searchLabels, SearchSections } from './SearchSections';
import { useSearch } from './useSearch';
import { searchErrorMessage } from './status';

export function SearchScreen() {
  const session = useSessionSnapshot();
  if (session.status !== 'authenticated') return null;
  return (
    <SearchContent
      key={session.user.id + ':' + session.generation}
      identity={{ userId: session.user.id, generation: session.generation }}
    />
  );
}
function SearchContent({ identity }: { identity: SessionIdentity }) {
  const c = useTheme();
  const data = useMobileData();
  const router = useRouter();
  const search = useSearch(identity);
  const { query, current, eligible, online, retryReady } = search;
  const [notice, setNotice] = useState('');
  const [opening, setOpening] = useState<string>();
  const navigation = useRef<AbortController | null>(null);
  const paging = useRef(false);
  const error = query.error instanceof ApiError ? query.error : null;
  const denied =
    error?.kind === 'session-changed' ||
    error?.kind === 'unauthenticated' ||
    [401, 403, 404].includes(error?.status ?? 0);
  const usable =
    eligible &&
    current &&
    !search.pagesChanged &&
    !denied &&
    query.isFetchedAfterMount &&
    !query.isRefetching &&
    (!query.isError || query.isFetchNextPageError);
  const pages = usable ? (query.data?.pages ?? []) : [];
  const groups = pages.at(-1)?.groups;
  const total = groups
    ? searchGroups.reduce((sum, key) => sum + groups[key].total, 0)
    : undefined;
  function cancelOpening() {
    navigation.current?.abort();
    navigation.current = null;
    setOpening(undefined);
  }
  function change(text: string, type = search.type) {
    cancelOpening();
    setNotice('');
    search.change(text, type);
  }
  useEffect(() => {
    if (!eligible) cancelOpening();
    return () => navigation.current?.abort();
  }, [eligible]);
  async function open(item: GlobalSearchItem) {
    if (
      !usable ||
      opening ||
      navigation.current ||
      !sameIdentity(identity, data.getIdentity())
    )
      return;
    const controller = new AbortController();
    navigation.current = controller;
    const snapshot = query.data;
    setOpening(item.type + ':' + item.id);
    setNotice('');
    try {
      const path = await verifySearchDestination(
        data,
        identity,
        item,
        controller.signal,
      );
      if (
        !controller.signal.aborted &&
        sameIdentity(identity, data.getIdentity()) &&
        data.queryClient.getQueryData(search.options.queryKey) === snapshot
      )
        router.navigate(path);
    } catch {
      if (
        !controller.signal.aborted &&
        sameIdentity(identity, data.getIdentity())
      )
        setNotice(
          'This result is unavailable or access could not be verified. Retry search to check what’s available.',
        );
    } finally {
      if (navigation.current === controller) {
        navigation.current = null;
        setOpening(undefined);
      }
    }
  }
  function refresh() {
    if (eligible && current && retryReady && !query.isFetching) {
      setNotice('');
      void query.refetch({ cancelRefetch: false });
    }
  }
  async function loadMore() {
    if (
      !eligible ||
      !current ||
      !retryReady ||
      query.isFetching ||
      paging.current ||
      !query.hasNextPage
    )
      return;
    paging.current = true;
    try {
      await query.fetchNextPage({ cancelRefetch: false });
    } finally {
      paging.current = false;
    }
  }
  const message = !online
    ? 'You’re offline. Reconnect to search.'
    : !search.endpointReady
      ? 'Too many requests. Wait before trying again.'
      : query.isError && current
        ? searchErrorMessage(query.error, query.isFetchNextPageError)
        : '';
  return (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}
      >
        <AppHeader subtitle="Search Kanvexa" />
        <SearchField
          label="Search workspaces, boards and cards"
          placeholder="Search workspaces, boards, cards…"
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          value={search.input}
          onChangeText={(text) => change(text)}
          onSubmitEditing={search.submit}
          error={search.validation.error}
          trailing={
            search.input ? (
              <Button
                label="Clear search"
                variant="link"
                onPress={() => change('')}
              />
            ) : undefined
          }
        />
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          {searchTypes.map((type) => {
            const count =
              type === 'all'
                ? search.type === 'all'
                  ? total
                  : undefined
                : groups && (search.type === 'all' || search.type === type)
                  ? groups[type].total
                  : undefined;
            return (
              <FilterChip
                key={type}
                label={
                  searchLabels[type] +
                  (count === undefined ? '' : ' · ' + count)
                }
                selected={type === search.type}
                onPress={() => change(search.input, type)}
              />
            );
          })}
        </View>
        {!search.validation.query && (
          <View style={{ gap: spacing.md }}>
            <Text style={[typography.body, { color: c.textSecondary }]}>
              Find workspaces, boards and cards you can access.
            </Text>
            <Text
              accessibilityRole="header"
              style={[typography.section, { color: c.text }]}
            >
              Try searching for
            </Text>
            {(['cards', 'boards', 'workspaces'] as const).map((type) => (
              <Button
                key={type}
                label={'Try searching ' + searchLabels[type]}
                variant="secondary"
                onPress={() => change(search.input, type)}
              />
            ))}
          </View>
        )}
        {!!notice && (
          <View style={{ gap: spacing.sm }}>
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.text }]}
            >
              {notice}
            </Text>
            {!message && (
              <Button
                label="Retry search"
                disabled={
                  !eligible || !current || !retryReady || query.isFetching
                }
                onPress={refresh}
              />
            )}
          </View>
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
                query.isFetchNextPageError ? 'Retry load more' : 'Retry search'
              }
              disabled={
                !eligible || !current || !retryReady || query.isFetching
              }
              onPress={
                query.isFetchNextPageError ? () => void loadMore() : refresh
              }
            />
          </View>
        )}
        {current && query.isFetching && !query.isFetchingNextPage && (
          <View testID="search-skeleton" style={{ gap: spacing.md }}>
            <Skeleton height={70} />
            <Skeleton height={70} />
            <Skeleton height={70} />
          </View>
        )}
        {total !== undefined && (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.supporting, { color: c.textSecondary }]}
          >
            {total === 0
              ? 'No results. Try another search.'
              : `${total} ${total === 1 ? 'result' : 'results'} for “${search.validation.query}”`}
          </Text>
        )}
        <SearchSections
          pages={pages}
          type={search.type}
          open={(item) => void open(item)}
          disabled={!usable || !!opening || query.isFetching}
          opening={opening}
          viewAll={(type) => change(search.input, type)}
        />
        {usable &&
          search.type !== 'all' &&
          query.hasNextPage &&
          !query.isFetchNextPageError && (
            <Button
              label="Load more results"
              loading={query.isFetchingNextPage}
              disabled={!retryReady}
              onPress={() => void loadMore()}
            />
          )}
      </ScrollView>
    </SafeAreaView>
  );
}
