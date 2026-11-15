import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  useEffect,
  useMemo,
  useRef,
  type ComponentRef,
  type ReactNode,
} from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import backIcon from 'expo-router/assets/react-navigation/elements/back-icon.png';
import logo from '../../../../assets/brand/kanvexa-logo-v1.png';
import type { SessionIdentity } from '../../../infrastructure/api/session-client';
import { useMobileData } from '../../../infrastructure/query/DataProvider';
import { queryKeys } from '../../../infrastructure/query/keys';
import { nextPage } from '../../../infrastructure/query/pagination';
import type { ResourceId } from '../../../navigation/routes';
import {
  Button,
  StatusChip,
  Surface,
  spacing,
  typography,
  useTheme,
} from '../../../ui';
import type { KanbanBoard } from '../../boards/kanban-api';
import {
  compareKanbanPosition,
  kanbanCollection,
} from '../../boards/kanban-model';
import { createColumnApi } from '../../columns/api';
import { canMutateColumns } from '../../columns/mutations';
import { workspaceErrorMessage } from '../../workspaces/status';
import { CardActionsSheet } from '../CardActionsSheet';
import type { Card } from '../decoder';
import { useCardLifecycle } from '../useCardLifecycle';
import { kanbanCardOptions } from '../../boards/kanban-queries';
import { CardTextEditor } from './CardTextEditor';
import {
  CardMetadataSection,
  CardChecklistsSection,
  CardAttachmentsSection,
  CardCommentsSection,
  type CardDetailContext,
  type CardDetailSections,
} from './sections';
import type { CardDraftController } from './useCardDraft';

export function DetailHeader({
  board,
  action,
}: {
  board?: KanbanBoard;
  action?: ReactNode;
}) {
  const router = useRouter();
  const c = useTheme();
  return (
    <View style={[cardDetailStyles.header, { borderBottomColor: c.border }]}>
      <Button
        label="Back"
        variant="icon"
        icon={
          <Image
            source={backIcon}
            style={{ width: 20, height: 24, tintColor: c.text }}
          />
        }
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace('/boards')
        }
      />
      <Image
        source={logo}
        accessibilityLabel="Kanvexa logo"
        resizeMode="contain"
        style={{ width: 28, height: 28 }}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          accessibilityRole="header"
          style={[typography.strong, { color: c.text }]}
        >
          Card details
        </Text>
        {board && (
          <Text
            numberOfLines={1}
            style={[typography.caption, { color: c.textSecondary }]}
          >
            {board.name}
          </Text>
        )}
      </View>
      {action}
    </View>
  );
}

export function CardDocument({
  boardId,
  cardId,
  identity,
  board,
  card,
  sections,
  focused,
  verifiedWrites,
  refreshCard,
  refreshBoard,
  readError,
  editor,
}: {
  boardId: ResourceId;
  cardId: ResourceId;
  identity: SessionIdentity;
  board: KanbanBoard;
  card: Card;
  sections: CardDetailSections;
  focused: boolean;
  verifiedWrites: boolean;
  refreshCard: () => Promise<unknown>;
  refreshBoard: () => Promise<unknown>;
  readError: unknown;
  editor: CardDraftController;
}) {
  const c = useTheme();
  const data = useMobileData();
  const router = useRouter();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const editorY = useRef(0);
  const canEdit =
    focused && verifiedWrites && canMutateColumns(board) && !card.isArchived;
  const columnsQuery = useInfiniteQuery({
    queryKey: queryKeys.columns(identity, boardId),
    initialPageParam: 1,
    queryFn: ({ signal, pageParam }) =>
      createColumnApi(data.api, identity, boardId).list(pageParam, signal),
    getNextPageParam: (page) => nextPage(page.meta),
    enabled: focused,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });
  const columns = useMemo(() => {
    const result = kanbanCollection(columnsQuery.data?.pages ?? []);
    result.items.sort(compareKanbanPosition);
    return result;
  }, [columnsQuery.data]);
  const column = columns.items.find(({ id }) => id === card.columnId);
  // Resolve the actual parent without scanning unrelated Cards or preview APIs.
  useEffect(() => {
    if (
      !column &&
      focused &&
      columnsQuery.hasNextPage &&
      !columnsQuery.isFetching &&
      !columnsQuery.isError
    )
      void columnsQuery.fetchNextPage({ cancelRefetch: false });
  }, [
    column,
    focused,
    columnsQuery.hasNextPage,
    columnsQuery.isFetching,
    columnsQuery.isError,
    columnsQuery.fetchNextPage,
  ]);
  const management = useCardLifecycle({
    boardId,
    identity,
    writable:
      focused && verifiedWrites && canMutateColumns(board) && !editor.draft,
    discard: false,
    discardWrites: !canMutateColumns(board),
    restoreToArchive: false,
    recheckBoard: () => {
      void refreshBoard();
      void refreshCard();
    },
  });
  const context: CardDetailContext = {
    identity,
    boardId,
    cardId,
    board,
    card,
    readOnly: !canEdit,
    canEdit,
    active: focused,
    refreshCard,
  };
  const actionsAllowed =
    verifiedWrites && canMutateColumns(board) && !editor.draft;
  const focusEditor = () =>
    scroll.current?.scrollTo({
      y: Math.max(0, editorY.current - spacing.lg),
      animated: false,
    });
  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      <KeyboardAvoidingView
        testID="card-detail-keyboard"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <DetailHeader
          board={board}
          action={
            actionsAllowed ? (
              <Button
                label={
                  card.isArchived ? 'Restore card options' : 'Card actions'
                }
                variant="icon"
                icon={
                  <View
                    style={{ flexDirection: 'row', gap: 3 }}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  >
                    {[0, 1, 2].map((dot) => (
                      <View
                        key={dot}
                        style={{
                          width: 3,
                          height: 3,
                          borderRadius: 2,
                          backgroundColor: c.textSecondary,
                        }}
                      />
                    ))}
                  </View>
                }
                onPress={() =>
                  management.open({
                    kind: card.isArchived ? 'restore' : 'actions',
                    card,
                  })
                }
              />
            ) : undefined
          }
        />
        <ScrollView
          testID="card-detail-scroll"
          ref={scroll}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={cardDetailStyles.content}
        >
          <Text style={[typography.supporting, { color: c.primaryPressed }]}>
            {board.name} › {column?.name ?? 'Column unavailable'}
          </Text>
          {(board.isArchived ||
            card.isArchived ||
            !board.capabilities.canWriteBoard) && (
            <StatusChip
              label={
                board.isArchived
                  ? 'Archived board · Read-only'
                  : card.isArchived
                    ? 'Archived card · Read-only'
                    : 'Read-only'
              }
              tone="info"
            />
          )}
          <View style={{ gap: spacing.sm }}>
            <Text
              selectable
              accessibilityRole="header"
              style={[typography.title, { color: c.text }]}
            >
              {card.title}
            </Text>
            <Text
              selectable
              style={[typography.supporting, { color: c.textSecondary }]}
            >
              Updated {new Date(card.updatedAt).toLocaleString()}
            </Text>
            {canEdit && !editor.draft && (
              <View style={{ alignSelf: 'flex-start' }}>
                <Button
                  label="Edit title"
                  variant="link"
                  onPress={() => editor.start('title')}
                />
              </View>
            )}
          </View>
          {readError ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.warning }]}
            >
              {workspaceErrorMessage(readError)} Your unsaved text is retained.
            </Text>
          ) : null}
          {editor.draft?.field === 'title' && (
            <View
              onLayout={(e) => {
                editorY.current = e.nativeEvent.layout.y;
              }}
            >
              <CardTextEditor
                editor={editor}
                canEdit={canEdit}
                onFocus={focusEditor}
              />
            </View>
          )}
          <CardMetadataSection context={context} section={sections.Metadata} />
          <View
            style={{ gap: spacing.sm }}
            onLayout={(e) => {
              if (editor.draft?.field !== 'title')
                editorY.current = e.nativeEvent.layout.y;
            }}
          >
            {editor.draft?.field === 'description' ? (
              <CardTextEditor
                editor={editor}
                canEdit={canEdit}
                onFocus={focusEditor}
              />
            ) : (
              <>
                <View style={cardDetailStyles.sectionHeading}>
                  <Text
                    accessibilityRole="header"
                    style={[typography.strong, { color: c.text }]}
                  >
                    Description
                  </Text>
                  {canEdit && !editor.draft && (
                    <Button
                      label="Edit description"
                      variant="link"
                      onPress={() => editor.start('description')}
                    />
                  )}
                </View>
                <Surface>
                  <Text
                    selectable
                    dataDetectorType="none"
                    style={[
                      typography.body,
                      {
                        color: card.description ? c.textSecondary : c.textMuted,
                      },
                    ]}
                  >
                    {card.description || 'No description'}
                  </Text>
                </Surface>
              </>
            )}
          </View>
          <CardChecklistsSection
            context={context}
            section={sections.Checklists}
          />
          <CardAttachmentsSection
            context={context}
            section={sections.Attachments}
          />
          <CardCommentsSection context={context} section={sections.Comments} />
          {columnsQuery.isError && (
            <Button
              label="Retry columns"
              variant="link"
              onPress={() => void columnsQuery.refetch()}
            />
          )}
          {!!management.notice && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.textSecondary }]}
            >
              {management.notice}
            </Text>
          )}
        </ScrollView>
        {actionsAllowed && !card.isArchived && (
          <View
            style={[
              cardDetailStyles.footer,
              { borderTopColor: c.border, backgroundColor: c.surface },
            ]}
          >
            <Button
              label="Move"
              variant="link"
              disabled={management.pending}
              onPress={() => management.open({ kind: 'move', card })}
            />
            <Button
              label="Edit card"
              disabled={management.pending}
              onPress={() => editor.start('description')}
            />
          </View>
        )}
      </KeyboardAvoidingView>
      <CardActionsSheet
        management={management}
        identity={identity}
        boardId={boardId}
        columns={columns.items}
        allowPrecision
        columnsPending={columnsQuery.isFetching}
        onLoadColumns={
          columnsQuery.hasNextPage
            ? () => void columnsQuery.fetchNextPage({ cancelRefetch: false })
            : undefined
        }
        refreshBoardForReview={async () => {
          await Promise.all([
            refreshBoard(),
            refreshCard(),
            data.queryClient.fetchInfiniteQuery(
              kanbanCardOptions(data.api, identity, boardId, {}),
            ),
          ]);
          router.dismissTo(`/boards/${boardId}`);
        }}
        onOpenCard={() => management.close()}
        onEditTitle={() => {
          management.close();
          editor.start('title');
        }}
      />
    </SafeAreaView>
  );
}

export const cardDetailStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: {
    padding: spacing.xl,
    gap: spacing.xl,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    paddingBottom: spacing.xxxl,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
});
