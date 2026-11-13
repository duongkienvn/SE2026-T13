import { useInfiniteQuery } from '@tanstack/react-query';
import { View, Text } from 'react-native';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import { useMobileData } from '../../infrastructure/query/DataProvider';
import { queryKeys } from '../../infrastructure/query/keys';
import { deduplicatePages } from '../../infrastructure/query/pagination';
import type { ResourceId } from '../../navigation/routes';
import {
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  Skeleton,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import { BoardArtwork } from '../home/BoardArtwork';
import { workspaceBoardOptions } from './queries';
import {
  canRetryWorkspace,
  useWorkspaceOnline,
  workspaceErrorMessage,
} from './status';

export function WorkspaceBoards({
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
  const options = workspaceBoardOptions(data, identity, workspace);
  const query = useInfiniteQuery({ ...options, enabled: active });
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
    if (query.isFetchNextPageError)
      void query.fetchNextPage({ cancelRefetch: false });
    else void query.refetch({ cancelRefetch: false });
  };
  return (
    <View style={{ gap: spacing.md }}>
      <Text
        accessibilityRole="header"
        style={[typography.section, { color: c.text }]}
      >
        All boards
      </Text>
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
          <EmptyState title="No boards in this workspace" />
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
              onPress={() => {
                const current = data.queryClient.getQueryData(options.queryKey);
                if (active && online && query.data && current === query.data)
                  onBoard(board.id);
              }}
            />
          </Surface>
        );
      })}
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
                disabled={query.isFetching}
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
