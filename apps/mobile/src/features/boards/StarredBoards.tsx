import { useInfiniteQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
import { deduplicatePages } from '../../infrastructure/query/pagination';
import type { ResourceId } from '../../navigation/routes';
import {
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { BoardArtwork } from '../home/BoardArtwork';
import { workspaceBoardOptions } from '../workspaces/queries';
import {
  canRetryWorkspace,
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from '../workspaces/status';
import { BoardStar } from './BoardStar';

export function StarredBoards({
  identity,
  workspace,
  active,
  onBoard,
}: {
  identity: SessionIdentity;
  workspace: ResourceId;
  active: boolean;
  onBoard: (id: ResourceId) => void;
}) {
  const data = useMobileData();
  const c = useTheme();
  const online = useWorkspaceOnline();
  const options = workspaceBoardOptions(data, identity, workspace, {
    starred: true,
  });
  const query = useInfiniteQuery({ ...options, enabled: active });
  const retryReady = useWorkspaceRetryReady(query.error, query.errorUpdatedAt);
  if (!data.resources.readable(queryKeys.workspace(identity, workspace)))
    return null;
  const boards = deduplicatePages(
    query.data?.pages.map((page) => page.data) ?? [],
  );
  return (
    <View style={{ gap: spacing.md }}>
      <Text
        accessibilityRole="header"
        style={[typography.section, { color: c.text }]}
      >
        Starred boards
      </Text>
      {query.isPending && online && (
        <Skeleton height={96} label="Loading starred boards" />
      )}
      {query.isSuccess && boards.length === 0 && (
        <EmptyState title="No starred boards yet" />
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.md }}
      >
        {query.hasPreviousPage && (
          <Button
            label="Load previous starred boards"
            variant="secondary"
            disabled={!active || !online || query.isFetching}
            onPress={() =>
              void query.fetchPreviousPage({ cancelRefetch: false })
            }
          />
        )}
        {boards.map((board) => (
          <View key={board.id} style={{ width: 180 }}>
            <Surface>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open board ${board.name}`}
                disabled={!active || !online}
                onPress={() => {
                  if (
                    active &&
                    online &&
                    query.data &&
                    data.queryClient.getQueryData(options.queryKey) ===
                      query.data
                  )
                    onBoard(board.id);
                }}
              >
                <BoardArtwork
                  preset={board.backgroundPreset}
                  width={146}
                  height={80}
                />
                <Text style={[typography.strong, { color: c.text }]}>
                  {board.name}
                </Text>
                {board.memberCount !== null && (
                  <Text
                    style={[typography.supporting, { color: c.textSecondary }]}
                  >
                    {board.memberCount}{' '}
                    {board.memberCount === 1 ? 'member' : 'members'}
                  </Text>
                )}
              </Pressable>
              {board.isStarred !== undefined && (
                <BoardStar
                  identity={identity}
                  id={board.id}
                  name={board.name}
                  starred={board.isStarred}
                  updatedAt={query.dataUpdatedAt}
                  disabled={!active || !online}
                />
              )}
            </Surface>
          </View>
        ))}
        {query.hasNextPage && (
          <Button
            label="Load more starred boards"
            variant="secondary"
            disabled={!online || query.isFetching}
            onPress={() => void query.fetchNextPage({ cancelRefetch: false })}
          />
        )}
      </ScrollView>
      {query.isError && (
        <ErrorState
          title="Starred boards unavailable"
          description={workspaceErrorMessage(query.error)}
          action={
            <Button
              label="Retry starred boards"
              variant="secondary"
              disabled={!active || !online || query.isFetching || !retryReady}
              onPress={() => {
                if (
                  !active ||
                  !online ||
                  query.isFetching ||
                  !canRetryWorkspace(query.error, query.errorUpdatedAt)
                )
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
    </View>
  );
}
