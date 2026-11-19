import type { GlobalSearchType } from '@kanban/shared';
import { focusManager, useInfiniteQuery } from '@tanstack/react-query';
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
import { searchInput } from './input';
import { searchOptions, searchCooldown, searchPagesChanged } from './queries';

const subscribeFocus = focusManager.subscribe.bind(focusManager);
const isForeground = () => focusManager.isFocused();
export function useSearch(identity: SessionIdentity) {
  const data = useMobileData();
  const focused = useIsFocused();
  const foreground = useSyncExternalStore(subscribeFocus, isForeground);
  const online = useWorkspaceOnline();
  const eligible = focused && foreground && online;
  const [input, setInput] = useState('');
  const [type, setType] = useState<GlobalSearchType>('all');
  const [submitted, setSubmitted] = useState<{
    query: string;
    type: GlobalSearchType;
  } | null>(null);
  const validation = searchInput(input);
  const current =
    !validation.error &&
    !!validation.query &&
    submitted?.query === validation.query &&
    submitted.type === type;
  const options = searchOptions(
    data,
    identity,
    validation.error ? '' : validation.query,
    type,
  );
  const cooldown = searchCooldown(data, identity);
  const endpointReady = useWorkspaceRetryReady(
    cooldown?.error,
    cooldown?.updatedAt ?? 0,
  );
  const query = useInfiniteQuery({
    ...options,
    enabled: ({ state }) =>
      eligible &&
      current &&
      endpointReady &&
      canRetryWorkspace(state.error, state.errorUpdatedAt),
  });
  const queryRetryReady = useWorkspaceRetryReady(
    query.error,
    query.errorUpdatedAt,
  );
  const retryReady = endpointReady && queryRetryReady;
  const pagesChanged = searchPagesChanged(query.data?.pages ?? []);

  function change(text: string, nextType = type) {
    const next = searchInput(text);
    if (
      next.query !== validation.query ||
      next.error !== validation.error ||
      nextType !== type
    ) {
      void data.queryClient.cancelQueries({
        queryKey: queryKeys.search(identity),
      });
      if (!next.error)
        data.queryClient.removeQueries({
          queryKey: searchOptions(data, identity, next.query, nextType)
            .queryKey,
          exact: true,
        });
      setSubmitted(null);
    }
    setInput(text);
    setType(nextType);
  }
  function submit() {
    if (!validation.error && validation.query)
      setSubmitted({ query: validation.query, type });
  }
  useEffect(() => {
    if (validation.error || !validation.query || current) return;
    const timer = setTimeout(
      () => setSubmitted({ query: validation.query, type }),
      250,
    );
    return () => clearTimeout(timer);
  }, [validation.query, validation.error, type, current]);
  useEffect(() => {
    if (!eligible && sameIdentity(identity, data.getIdentity()))
      data.evict(identity, [queryKeys.search(identity)]);
    else if (current && retryReady)
      void query.refetch({ cancelRefetch: false });
    // Route/foreground/reconnect transitions require a fresh authoritative read.
  }, [eligible]);
  useEffect(() => {
    if (pagesChanged && eligible && current && retryReady && !query.isFetching)
      void data.queryClient
        .resetQueries({ queryKey: options.queryKey, exact: true })
        .catch(() => undefined);
  }, [
    pagesChanged,
    eligible,
    current,
    retryReady,
    query.isFetching,
    data,
    query.data,
  ]);
  useEffect(
    () => () => {
      void data.queryClient.cancelQueries({
        queryKey: queryKeys.search(identity),
      });
    },
    [data, identity.userId, identity.generation],
  );
  return {
    input,
    type,
    change,
    submit,
    current,
    validation,
    query,
    options,
    eligible,
    online,
    retryReady,
    pagesChanged,
    endpointReady,
  };
}
