import type { UseQueryResult } from '@tanstack/react-query';
import type { ApiPaginatedResponse } from '@kanban/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import {
  Button,
  LoadingState,
  TextField,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import { useWorkspaceRetryReady, workspaceErrorMessage } from '../status';
import { maxWorkspacePage } from '../api';

export function useRosterPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  return {
    page,
    setPage,
    search,
    draft,
    setDraft,
    submitSearch() {
      setPage(1);
      setSearch(draft.trim());
    },
  };
}

export function RosterSearch({
  roster,
}: {
  roster: ReturnType<typeof useRosterPage>;
}) {
  return (
    <>
      <TextField
        label="Search by display name"
        value={roster.draft}
        onChangeText={roster.setDraft}
        maxLength={120}
        returnKeyType="search"
        onSubmitEditing={roster.submitSearch}
      />
      <Button
        label="Search"
        variant="secondary"
        onPress={roster.submitSearch}
      />
    </>
  );
}

export function RosterPage<T>({
  roster,
  query,
  itemLabel,
  empty,
  render,
}: {
  roster: ReturnType<typeof useRosterPage>;
  query: UseQueryResult<ApiPaginatedResponse<T>>;
  itemLabel: string;
  empty: string;
  render: (row: T) => ReactNode;
}) {
  const c = useTheme();
  const ready = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  const lastPage = query.isSuccess
    ? Math.max(1, query.data.meta.totalPages)
    : roster.page;
  const { page, setPage } = roster;
  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [lastPage, page, setPage]);
  if (query.isError)
    return (
      <>
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.body, { color: c.text }]}
        >
          {workspaceErrorMessage(query.error)}
        </Text>
        <Button
          label="Retry directory"
          disabled={!ready || query.isFetching}
          onPress={() => void query.refetch()}
        />
      </>
    );
  if (!query.data || page > lastPage)
    return <LoadingState label="Loading directory" />;
  const { meta, data } = query.data;
  return (
    <>
      <Text
        accessibilityLiveRegion="polite"
        style={[typography.supporting, { color: c.textSecondary }]}
      >
        {meta.total} {itemLabel}
        {meta.total === 1 ? '' : 's'}
        {meta.totalPages > 1 && ` · Page ${meta.page} of ${meta.totalPages}`}
      </Text>
      {data.length ? (
        data.map(render)
      ) : (
        <Text style={[typography.body, { color: c.textSecondary }]}>
          {empty}
        </Text>
      )}
      <View style={{ gap: spacing.sm }}>
        {page > 1 && (
          <Button
            label="Previous page"
            variant="secondary"
            onPress={() => setPage(page - 1)}
          />
        )}
        {page < lastPage && page < maxWorkspacePage && (
          <Button
            label="Next page"
            variant="secondary"
            onPress={() => setPage(page + 1)}
          />
        )}
        <Button
          label="Refresh directory"
          variant="link"
          disabled={query.isFetching}
          onPress={() => void query.refetch()}
        />
      </View>
    </>
  );
}
