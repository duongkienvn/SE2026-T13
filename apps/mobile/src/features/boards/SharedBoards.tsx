import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
import {
  deduplicatePages,
  nextPage,
} from '../../infrastructure/query/pagination';
import type { ResourceId } from '../../navigation/routes';
import {
  Button,
  Chip,
  ErrorState,
  ListRow,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { BoardArtwork } from '../home/BoardArtwork';
import type { WorkspaceSummary } from '../workspaces/decoder';
import {
  canRetryWorkspace,
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from '../workspaces/status';
import { createBoardApi } from './api';
import { BoardStar } from './BoardStar';
import { BoardEditor } from './BoardEditor';
import { BoardRowActions } from './BoardRowActions';

export function SharedBoards({
  identity,
  workspaces,
  membershipUpdatedAt,
  active,
  onBoard,
}: {
  identity: SessionIdentity;
  workspaces: WorkspaceSummary[];
  membershipUpdatedAt: number;
  active: boolean;
  onBoard: (id: ResourceId) => void;
}) {
  const data = useMobileData();
  const c = useTheme();
  const online = useWorkspaceOnline();
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [editing, setEditing] = useState<ResourceId | null>(null);
  const key = queryKeys.boards(identity, null, {
    status,
    limit: 20,
    joined: workspaces.map((workspace) => workspace.id).sort(),
  });
  const query = useInfiniteQuery({
    queryKey: key,
    enabled: active,
    staleTime: 0,
    refetchOnMount: 'always',
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      createBoardApi(data.api, identity).list(pageParam, status, signal),
    getNextPageParam: ({ meta }) => nextPage(meta),
    getPreviousPageParam: ({ meta }) =>
      meta.page > 1 ? meta.page - 1 : undefined,
    maxPages: 5,
  });
  const retryReady = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  const refreshedFor = useRef(0);
  useEffect(() => {
    if (
      active &&
      online &&
      query.isSuccess &&
      !query.isFetching &&
      query.dataUpdatedAt < membershipUpdatedAt &&
      refreshedFor.current !== membershipUpdatedAt
    ) {
      refreshedFor.current = membershipUpdatedAt;
      void query.refetch({ cancelRefetch: true });
    }
  }, [
    active,
    online,
    query.isSuccess,
    query.isFetching,
    query.dataUpdatedAt,
    query.refetch,
    membershipUpdatedAt,
  ]);
  const joined = new Set(workspaces.map((workspace) => workspace.id));
  const verified =
    query.isSuccess &&
    (!query.isFetching ||
      query.isFetchingNextPage ||
      query.isFetchingPreviousPage) &&
    query.dataUpdatedAt >= membershipUpdatedAt;
  const boards = deduplicatePages(
    verified ? query.data.pages.map((page) => page.data) : [],
  ).filter(
    (board) =>
      board.currentUserRole !== null &&
      !joined.has(board.workspaceId) &&
      data.resources.readable(queryKeys.board(identity, board.id)),
  );
  return (
    <View style={{ gap: spacing.md }}>
      <Text
        accessibilityRole="header"
        style={[typography.section, { color: c.text }]}
      >
        Shared with me
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <Chip
          label="Active shared boards"
          selected={status === 'active'}
          onPress={() => setStatus('active')}
        />
        <Chip
          label="Archived shared boards"
          selected={status === 'archived'}
          onPress={() => setStatus('archived')}
        />
      </View>
      {query.hasPreviousPage && (
        <Button
          label="Load previous shared boards"
          variant="secondary"
          disabled={!active || !online || query.isFetching}
          onPress={() => void query.fetchPreviousPage({ cancelRefetch: false })}
        />
      )}
      {verified && boards.length === 0 && (
        <Text style={[typography.body, { color: c.textSecondary }]}>
          {query.hasNextPage
            ? 'No shared boards in the loaded results.'
            : 'No shared boards.'}
        </Text>
      )}
      {boards.map((board) => (
        <Surface key={board.id}>
          <ListRow
            title={board.name}
            subtitle={board.isArchived ? 'Archived · Read only' : undefined}
            leading={<BoardArtwork preset={board.backgroundPreset} />}
            accessibilityLabel={`Open shared board ${board.name}`}
            disabled={!active || !online}
            onPress={() => {
              if (
                active &&
                online &&
                data.queryClient.getQueryData(key) === query.data
              )
                onBoard(board.id);
            }}
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
                <BoardRowActions
                  board={board}
                  disabled={!active || !online}
                  current={() =>
                    active &&
                    online &&
                    data.queryClient.getQueryData(key) === query.data
                  }
                  onEdit={() => setEditing(board.id)}
                />
              </View>
            }
          />
        </Surface>
      ))}
      {editing && (
        <BoardEditor
          identity={identity}
          id={editing}
          active={active}
          onDismiss={() => setEditing(null)}
        />
      )}
      {query.isError && (
        <ErrorState
          title="Shared boards unavailable"
          description={workspaceErrorMessage(query.error)}
          action={
            <Button
              label="Retry shared boards"
              variant="secondary"
              disabled={!active || !online || query.isFetching || !retryReady}
              onPress={() => {
                if (!canRetryWorkspace(query.error, query.errorUpdatedAt))
                  return;
                if (query.isFetchPreviousPageError)
                  void query.fetchPreviousPage({ cancelRefetch: false });
                else if (query.isFetchNextPageError)
                  void query.fetchNextPage({ cancelRefetch: false });
                else void query.refetch({ cancelRefetch: false });
              }}
            />
          }
        />
      )}
      {query.hasNextPage && !query.isError && (
        <Button
          label="Load more shared boards"
          variant="secondary"
          disabled={!active || !online || query.isFetching}
          onPress={() => void query.fetchNextPage({ cancelRefetch: false })}
        />
      )}
    </View>
  );
}
