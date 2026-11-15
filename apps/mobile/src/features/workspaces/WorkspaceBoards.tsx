import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { BoardRole } from '@kanban/shared';
import { View, Text } from 'react-native';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
import { deduplicatePages } from '../../infrastructure/query/pagination';
import type { ResourceId } from '../../navigation/routes';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  SearchField,
  Skeleton,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { BoardArtwork } from '../home/BoardArtwork';
import { BoardStar } from '../boards/BoardStar';
import { BoardEditor } from '../boards/BoardEditor';
import { workspaceBoardOptions } from './queries';
import {
  canRetryWorkspace,
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from './status';

export type BoardFilters = {
  search: string;
  submittedSearch: string;
  status: 'active' | 'archived';
  sort: 'updatedAt' | 'createdAt' | 'name' | 'recent';
};
export const defaultBoardFilters: BoardFilters = {
  search: '',
  submittedSearch: '',
  status: 'active',
  sort: 'updatedAt',
};

export function WorkspaceBoards({
  identity,
  workspace,
  active,
  onBoard,
  filters,
  onFiltersChange,
  onCreateBoard,
}: {
  identity: SessionIdentity;
  workspace: ResourceId;
  active: boolean;
  onBoard: (id: ResourceId) => void;
  filters: BoardFilters;
  onFiltersChange: (filters: BoardFilters) => void;
  onCreateBoard?: () => void;
}) {
  const data = useMobileData();
  const c = useTheme();
  const online = useWorkspaceOnline();
  const [editing, setEditing] = useState<ResourceId | null>(null);
  const { search, submittedSearch, status, sort } = filters;
  const change = (next: Partial<BoardFilters>) =>
    onFiltersChange({ ...filters, ...next });
  const options = workspaceBoardOptions(data, identity, workspace, {
    status,
    sort,
    ...(submittedSearch ? { search: submittedSearch } : {}),
  });
  const query = useInfiniteQuery({ ...options, enabled: active });
  const retryReady = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  if (!data.resources.readable(queryKeys.workspace(identity, workspace)))
    return null;
  const boards = deduplicatePages(
    query.data?.pages.map((page) => page.data) ?? [],
  );
  const retry = () => {
    if (
      !active ||
      !online ||
      data.queryClient.isFetching({
        queryKey: options.queryKey,
        exact: true,
      }) ||
      !canRetryWorkspace(query.error, query.errorUpdatedAt)
    )
      return;
    if (query.isFetchPreviousPageError)
      void query.fetchPreviousPage({ cancelRefetch: false });
    else if (query.isFetchNextPageError)
      void query.fetchNextPage({ cancelRefetch: false });
    else void query.refetch({ cancelRefetch: false });
  };
  return (
    <View style={{ gap: spacing.md }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.sm,
        }}
      >
        <Text
          accessibilityRole="header"
          style={[typography.section, { color: c.text }]}
        >
          All boards
        </Text>
        {onCreateBoard && (
          <Button
            label="Create board"
            variant="secondary"
            disabled={!active || !online}
            onPress={onCreateBoard}
          />
        )}
      </View>
      <SearchField
        label="Search boards"
        value={search}
        maxLength={120}
        onChangeText={(search) => change({ search })}
        onSubmitEditing={() => change({ submittedSearch: search.trim() })}
      />
      <Button
        label="Apply board search"
        variant="secondary"
        onPress={() => change({ submittedSearch: search.trim() })}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Chip
          label="Active"
          selected={status === 'active'}
          onPress={() => change({ status: 'active' })}
        />
        <Chip
          label="Archived"
          selected={status === 'archived'}
          onPress={() => change({ status: 'archived' })}
        />
        {(
          [
            ['updatedAt', 'Updated'],
            ['createdAt', 'Created'],
            ['name', 'Name'],
            ['recent', 'Recent'],
          ] as const
        ).map(([value, label]) => (
          <Chip
            key={value}
            label={`Sort by ${label.toLowerCase()}`}
            selected={sort === value}
            onPress={() => change({ sort: value })}
          />
        ))}
      </View>
      {query.hasPreviousPage && (
        <Button
          label="Load previous boards"
          variant="secondary"
          disabled={!active || !online || query.isFetching}
          onPress={() => void query.fetchPreviousPage({ cancelRefetch: false })}
        />
      )}
      {query.isPending &&
        online &&
        !query.isPaused &&
        [0, 1, 2].map((index) => (
          <Surface key={index}>
            <Skeleton
              height={40}
              label={index === 0 ? 'Loading boards' : 'Loading'}
            />
          </Surface>
        ))}
      {query.data && boards.length === 0 && !query.isError && (
        <Surface>
          <EmptyState
            title={
              submittedSearch
                ? 'No boards match your search'
                : status === 'archived'
                  ? 'No archived boards'
                  : 'No boards in this workspace'
            }
          />
        </Surface>
      )}
      {boards.map((board) => {
        const count = board.memberCount;
        const meta = [
          board.isArchived ? 'Archived · Read only' : '',
          count === null
            ? ''
            : `${count} ${count === 1 ? 'member' : 'members'}`,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <Surface key={board.id}>
            <ListRow
              disabled={!active || !online}
              title={board.name}
              subtitle={meta || undefined}
              accessibilityLabel={`Open board ${board.name}${meta ? ', ' + meta : ''}`}
              leading={<BoardArtwork preset={board.backgroundPreset} />}
              trailing={
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {board.isStarred === undefined ? null : (
                    <BoardStar
                      identity={identity}
                      id={board.id}
                      name={board.name}
                      starred={board.isStarred}
                      updatedAt={query.dataUpdatedAt}
                      disabled={!active || !online}
                    />
                  )}
                  {!board.isArchived &&
                    board.currentUserRole === BoardRole.OWNER && (
                      <Button
                        label={`Edit ${board.name}`}
                        variant="link"
                        disabled={!active || !online}
                        onPress={() => {
                          if (
                            active &&
                            online &&
                            data.queryClient.getQueryData(options.queryKey) ===
                              query.data
                          )
                            setEditing(board.id);
                        }}
                      />
                    )}
                </View>
              }
              onPress={() => {
                const current = data.queryClient.getQueryData(options.queryKey);
                if (active && online && query.data && current === query.data)
                  onBoard(board.id);
              }}
            />
          </Surface>
        );
      })}
      {editing && (
        <BoardEditor
          identity={identity}
          id={editing}
          active={active}
          onDismiss={() => setEditing(null)}
        />
      )}
      {query.isError && online && (
        <Surface>
          <ErrorState
            title="Boards unavailable"
            description={workspaceErrorMessage(query.error)}
            action={
              <Button
                label="Retry boards"
                variant="secondary"
                onPress={retry}
                disabled={!active || query.isFetching || !retryReady}
              />
            }
          />
        </Surface>
      )}
      {query.hasNextPage && !query.isError && (
        <Button
          label="Load more boards"
          variant="secondary"
          loading={query.isFetchingNextPage}
          disabled={!online || query.isFetching}
          onPress={() => {
            if (
              active &&
              online &&
              !data.queryClient.isFetching({
                queryKey: options.queryKey,
                exact: true,
              })
            )
              void query.fetchNextPage({ cancelRefetch: false });
          }}
        />
      )}
    </View>
  );
}
