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
  online,
}: {
  roster: ReturnType<typeof useRosterPage>;
  online: boolean;
}) {
  return (
    <>
      <TextField
        label="Search by display name"
        value={roster.draft}
        editable={online}
        onChangeText={roster.setDraft}
        maxLength={120}
        returnKeyType="search"
        onSubmitEditing={online ? roster.submitSearch : undefined}
      />
      <Button
        label="Search"
        variant="secondary"
        disabled={!online}
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
  online,
}: {
  roster: ReturnType<typeof useRosterPage>;
  query: UseQueryResult<ApiPaginatedResponse<T>>;
  itemLabel: string;
  empty: string;
  render: (row: T) => ReactNode;
  online: boolean;
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
          disabled={!online || !ready || query.isFetching}
          onPress={() => void query.refetch()}
        />
      </>
    );
  if (!query.data || page > lastPage)
    return online ? <LoadingState label="Loading directory" /> : null;
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
            disabled={!online}
            onPress={() => setPage(page - 1)}
          />
        )}
        {page < lastPage && page < maxWorkspacePage && (
          <Button
            label="Next page"
            variant="secondary"
            disabled={!online}
            onPress={() => setPage(page + 1)}
          />
        )}
        <Button
          label="Refresh directory"
          variant="link"
          disabled={!online || query.isFetching}
          onPress={() => void query.refetch()}
        />
      </View>
    </>
  );
}
