import { useQuery } from '@tanstack/react-query';
import { Stack, useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../../../infrastructure/api/errors';
import type { SessionIdentity } from '../../../infrastructure/api/session-client';
import { useSessionSnapshot } from '../../../infrastructure/auth/SessionProvider';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { queryKeys } from '../../../infrastructure/query/keys';
import {
  useBoardRealtime,
  useRealtime,
} from '../../../infrastructure/realtime/RealtimeProvider';
import { ResourceBoundary } from '../../../navigation/resource-boundary';
import type { ResourceId } from '../../../navigation/routes';
import {
  Button,
  ErrorState,
  Skeleton,
  UnsavedChangesPrompt,
  useTheme,
} from '../../../ui';
import { createKanbanApi, isAccessDenied } from '../../boards/kanban-api';
import { canMutateColumns } from '../../columns/mutations';
import {
  useWorkspaceOnline,
  useWorkspaceRetryReady,
  workspaceErrorMessage,
} from '../../workspaces/status';
import { cardOptions } from '../queries';
import type { CardDetailSections } from './sections';
import { useCardDraft } from './useCardDraft';
import { useDraftNavigation } from './useDraftNavigation';
import {
  CardDocument,
  DetailHeader,
  cardDetailStyles as styles,
} from './CardDetailContent';

export function CardDetailScreen({
  boardId,
  cardId,
  sections = {},
}: {
  boardId: ResourceId | null;
  cardId: ResourceId | null;
  sections?: CardDetailSections;
}) {
  const session = useSessionSnapshot();
  if (!boardId || !cardId || session.status !== 'authenticated')
    return <ResourceBoundary access="unavailable" />;
  const identity = { userId: session.user.id, generation: session.generation };
  return (
    <CardEntry
      key={`${identity.userId}:${identity.generation}:${boardId}:${cardId}`}
      {...{ boardId, cardId, identity, sections }}
    />
  );
}

function CardEntry({
  boardId,
  cardId,
  identity,
  sections,
}: {
  boardId: ResourceId;
  cardId: ResourceId;
  identity: SessionIdentity;
  sections: CardDetailSections;
}) {
  const data = useMobileData();
  const realtime = useRealtime();
  const focused = useIsFocused();
  const online = useWorkspaceOnline();
  const room = useBoardRealtime(boardId, focused, true);
  const c = useTheme();
  const [childDenied, setChildDenied] = useState(false);
  const boardKey = queryKeys.board(identity, boardId);
  const key = queryKeys.card(identity, boardId, cardId);
  const board = useQuery({
    queryKey: boardKey,
    enabled:
      focused && room.status !== 'unavailable' && room.status !== 'checking',
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
    async queryFn({ signal }) {
      const current = data.resources.captureBoardProbe(boardId);
      try {
        const result = await createKanbanApi(data.api, identity, boardId).board(
          signal,
        );
        if (signal.aborted) throw new ApiError('aborted');
        data.assertCurrent(identity);
        current();
        if (!result) {
          realtime.revokeBoard(boardId);
          return null;
        }
        data.resources.confirmBoard(
          boardId,
          canMutateColumns(result),
          result.workspaceId,
        );
        return result;
      } catch (error) {
        if (!signal.aborted && isAccessDenied(error)) {
          data.assertCurrent(identity);
          current();
          realtime.revokeBoard(boardId);
        }
        throw error;
      }
    },
  });
  const boardVerified =
    board.isFetchedAfterMount &&
    !!board.data &&
    data.resources.readable(boardKey) &&
    room.status !== 'unavailable' &&
    room.status !== 'checking';
  const detail = useQuery({
    ...cardOptions(data, identity, boardId, cardId),
    enabled: focused && boardVerified,
    gcTime: 0,
    refetchOnMount: 'always',
  });
  const unavailable =
    childDenied ||
    room.status === 'unavailable' ||
    board.data === null ||
    isAccessDenied(board.error) ||
    isAccessDenied(detail.error);
  const retryReady = useWorkspaceRetryReady(
    detail.error ?? board.error,
    Math.max(detail.errorUpdatedAt, board.errorUpdatedAt),
  );
  const ready =
    !unavailable &&
    boardVerified &&
    detail.isFetchedAfterMount &&
    !!detail.data &&
    data.resources.readable(key);
  const verifiedWrites =
    online &&
    !board.isError &&
    !detail.isError &&
    !board.isFetching &&
    !detail.isFetching;
  const editor = useCardDraft({
    data,
    identity,
    boardId,
    cardId,
    card: detail.data ?? null,
    canEdit:
      ready &&
      focused &&
      verifiedWrites &&
      canMutateColumns(board.data) &&
      detail.data?.isArchived === false,
    onUnavailable: () => setChildDenied(true),
  });
  const navigation = useDraftNavigation(
    editor,
    `/boards/${boardId}/cards/${cardId}`,
    !unavailable,
  );
  useEffect(() => {
    if (unavailable) editor.clear();
  }, [unavailable, editor.clear]);
  const retry = async () => {
    realtime.retryBoard(boardId);
    await board.refetch();
    await detail.refetch();
  };
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {ready && board.data && detail.data ? (
        <CardDocument
          {...{ identity, boardId, cardId, sections, focused }}
          board={board.data}
          card={detail.data}
          verifiedWrites={verifiedWrites}
          editor={editor}
          refreshCard={async () => {
            const result = await detail.refetch();
            if (result.error) throw result.error;
            return result.data;
          }}
          refreshBoard={async () => {
            const result = await board.refetch();
            if (result.error) throw result.error;
            return result.data;
          }}
          readError={board.error ?? detail.error}
        />
      ) : (
        <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
          <DetailHeader />
          {unavailable ? (
            <ErrorState
              title="Card unavailable"
              description="This destination is unavailable."
            />
          ) : board.isError || detail.isError || !online ? (
            <ErrorState
              title="Couldn’t open card"
              description={
                !online
                  ? 'Reconnect to verify card access.'
                  : workspaceErrorMessage(detail.error ?? board.error)
              }
              action={
                <Button
                  label="Retry card"
                  disabled={!online || !retryReady}
                  onPress={() => void retry()}
                />
              }
            />
          ) : (
            <View style={styles.content}>
              <Skeleton width="65%" height={20} label="Checking card access" />
              <Skeleton height={64} />
              <Skeleton height={90} />
              <Skeleton height={180} />
            </View>
          )}
        </SafeAreaView>
      )}
      <UnsavedChangesPrompt
        visible={navigation.prompt}
        onDiscard={navigation.discard}
        onKeepEditing={navigation.keepEditing}
      />
    </>
  );
}
