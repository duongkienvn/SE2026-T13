import {
  focusManager,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  sameIdentity,
  type SessionIdentity,
} from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
import {
  canRetryWorkspace,
  useWorkspaceOnline,
  useWorkspaceRetryReady,
} from '../workspaces/status';
import { datePreferencesOptions } from '../cards/metadata/queries';
import { utcPreferences } from '../cards/metadata/dates';
import { inboxCommands } from './mutations';
import { inboxOptions, pagesChanged, unreadOptions } from './queries';
import { inboxCooldown } from './retry';
import type { InboxFilter } from './api';
const subscribeFocus = focusManager.subscribe.bind(focusManager);
const foregroundSnapshot = () => focusManager.isFocused();
export function useInbox(identity: SessionIdentity) {
  const data = useMobileData(),
    focused = useIsFocused();
  const foreground = useSyncExternalStore(subscribeFocus, foregroundSnapshot),
    online = useWorkspaceOnline();
  const eligible = focused && foreground && online;
  const commands = inboxCommands(data, identity);
  const mutation = useSyncExternalStore(
    commands.subscribe,
    commands.getSnapshot,
  );
  const [filter, setFilter] = useState<InboxFilter>('all');
  const listBudget = inboxCooldown(data, identity, 'list'),
    countBudget = inboxCooldown(data, identity, 'count');
  const listBudgetReady = useWorkspaceRetryReady(
    listBudget?.error,
    listBudget?.updatedAt ?? 0,
  );
  const countBudgetReady = useWorkspaceRetryReady(
    countBudget?.error,
    countBudget?.updatedAt ?? 0,
  );
  const writableReads = eligible && !mutation.pending && !mutation.mustReview;
  const options = inboxOptions(data, identity, filter);
  const list = useInfiniteQuery({
    ...options,
    enabled: ({ state }) =>
      writableReads &&
      listBudgetReady &&
      canRetryWorkspace(state.error, state.errorUpdatedAt),
  });
  const unread = useQuery({
    ...unreadOptions(data, identity),
    enabled: ({ state }) =>
      writableReads &&
      countBudgetReady &&
      canRetryWorkspace(state.error, state.errorUpdatedAt),
  });
  const listErrorReady = useWorkspaceRetryReady(
      list.error,
      list.errorUpdatedAt,
    ),
    countErrorReady = useWorkspaceRetryReady(
      unread.error,
      unread.errorUpdatedAt,
    );
  const writesReady = useWorkspaceRetryReady(
    mutation.error,
    mutation.errorUpdatedAt,
  );
  const preferences = useQuery({
    ...datePreferencesOptions(data.api, identity),
    enabled: eligible,
  });
  const dates = preferences.isError
    ? utcPreferences
    : (preferences.data ?? utcPreferences);
  const changed = pagesChanged(list.data?.pages ?? []);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!eligible) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    };
    tick();
    return () => clearTimeout(timer);
  }, [eligible]);
  useEffect(() => {
    if (!eligible && sameIdentity(identity, data.getIdentity()))
      data.evict(identity, [queryKeys.notifications(identity)]);
  }, [eligible]);
  useEffect(() => {
    if (changed && writableReads && listBudgetReady && !list.isFetching)
      void data.queryClient
        .resetQueries({ queryKey: options.queryKey, exact: true })
        .catch(() => undefined);
  }, [
    changed,
    writableReads,
    listBudgetReady,
    list.isFetching,
    list.data,
    data,
  ]);
  useEffect(
    () => () => {
      void data.queryClient.cancelQueries({
        queryKey: queryKeys.notifications(identity),
      });
    },
    [data, identity.userId, identity.generation],
  );
  function changeFilter(next: InboxFilter) {
    if (next === filter || mutation.pending) return;
    void data.queryClient.cancelQueries({
      queryKey: [...queryKeys.notifications(identity), 'list'],
    });
    data.queryClient.removeQueries({
      queryKey: inboxOptions(data, identity, next).queryKey,
      exact: true,
    });
    setFilter(next);
  }
  return {
    list,
    unread,
    filter,
    changeFilter,
    options,
    commands,
    mutation,
    eligible,
    online,
    listReady: listBudgetReady && listErrorReady,
    countReady: countBudgetReady && countErrorReady,
    writesReady,
    dates,
    now,
    changed,
  };
}
