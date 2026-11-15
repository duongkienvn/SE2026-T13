import { useState } from 'react';
import { Text, View } from 'react-native';
import type { SessionIdentity } from '../../infrastructure/api/session-client';
import {
  BottomSheet,
  Button,
  TextField,
  spacing,
  typography,
  useTheme,
} from '../../ui';
import type { KanbanCard, KanbanColumn } from '../boards/kanban-api';
import { isUncertainColumnWrite } from '../columns/mutations';
import { useWorkspaceRetryReady } from '../workspaces/status';
import { ArchivedCardsList } from './ArchivedCardsList';
import { moveAnchor, type CardPlacement } from './ordering';
import { useCardOrder } from './queries';
import { cardActionMessage, type CardLifecycle } from './useCardLifecycle';

const placements: Record<CardPlacement, string> = {
  top: 'Move to top',
  up: 'Move up',
  down: 'Move down',
  bottom: 'Move to bottom',
};

function CardDestination({
  identity,
  boardId,
  card,
  columns,
  allowPrecision,
  management,
  duplicate,
  blocked,
}: {
  identity: SessionIdentity;
  boardId: string;
  card: KanbanCard;
  columns: readonly KanbanColumn[];
  allowPrecision: boolean;
  management: CardLifecycle;
  duplicate: boolean;
  blocked: boolean;
}) {
  const c = useTheme();
  const [columnId, setColumnId] = useState(card.columnId);
  const selected = columns.find(({ id }) => id === columnId);
  const order = useCardOrder(
    identity,
    boardId,
    columnId,
    !!selected && allowPrecision && !duplicate,
  );
  const same = columnId === card.columnId;
  // staleTime 0 refetches on reopen. While mounted, a completed read can be
  // offered as a snapshot; the command checks it again before the PATCH.
  const snapshot =
    selected && allowPrecision && order.isSuccess && !order.isFetching
      ? order.data
      : undefined;
  const retryReady = useWorkspaceRetryReady(order.error, order.errorUpdatedAt);
  const move = (placement: 'append' | CardPlacement) => {
    if (placement !== 'append' && !snapshot) return;
    void management.run({
      kind: 'move',
      id: card.id,
      fromColumnId: card.columnId,
      toColumnId: columnId,
      placement:
        placement === 'append'
          ? { kind: 'append' }
          : { kind: placement, revision: snapshot!.revision },
    });
  };
  return (
    <>
      <Text style={[typography.strong, { color: c.text }]}>
        Destination column
      </Text>
      <View style={{ gap: spacing.sm }}>
        {columns.map((column) => (
          <Button
            key={column.id}
            label={
              column.id === columnId ? `${column.name} (selected)` : column.name
            }
            variant={column.id === columnId ? 'primary' : 'secondary'}
            disabled={management.pending}
            onPress={() => setColumnId(column.id)}
          />
        ))}
      </View>
      {duplicate ? (
        <Button
          label="Duplicate card"
          loading={management.pending}
          disabled={blocked || !selected}
          onPress={() =>
            void management.run({
              kind: 'duplicate',
              id: card.id,
              columnId: same ? undefined : columnId,
            })
          }
        />
      ) : (
        <>
          {allowPrecision && order.isFetching && (
            <Text style={[typography.supporting, { color: c.textSecondary }]}>
              Checking card order…
            </Text>
          )}
          {allowPrecision && order.isError && (
            <Button
              label="Retry card order"
              variant="secondary"
              disabled={!retryReady || blocked}
              onPress={() => void order.refetch()}
            />
          )}
          {!allowPrecision && (
            <Text style={[typography.supporting, { color: c.textSecondary }]}>
              Clear filters and sorting to choose a precise position.
            </Text>
          )}
          {same &&
            snapshot?.ids.includes(card.id) &&
            (['top', 'up', 'down'] as const).map((placement) => (
              <Button
                key={placement}
                label={placements[placement]}
                variant="secondary"
                disabled={
                  blocked ||
                  moveAnchor(snapshot.ids, card.id, placement) === undefined
                }
                onPress={() => move(placement)}
              />
            ))}
          {!same && !!snapshot?.ids.length && (
            <Button
              label={placements.top}
              variant="secondary"
              disabled={blocked}
              onPress={() => move('top')}
            />
          )}
          <Button
            label={same ? placements.bottom : 'Move to end of column'}
            loading={management.pending}
            disabled={
              blocked ||
              !selected ||
              (same &&
                !!snapshot &&
                moveAnchor(snapshot.ids, card.id, 'bottom') === undefined)
            }
            onPress={() => move(snapshot ? 'bottom' : 'append')}
          />
        </>
      )}
    </>
  );
}

export function CardActionsSheet({
  management,
  identity,
  boardId,
  columns,
  allowPrecision,
  columnsPending,
  onLoadColumns,
  onOpenCard,
}: {
  management: CardLifecycle;
  identity: SessionIdentity;
  boardId: string;
  columns: readonly KanbanColumn[];
  allowPrecision: boolean;
  columnsPending: boolean;
  onLoadColumns?: () => void;
  onOpenCard: (card: KanbanCard) => void;
}) {
  const c = useTheme();
  const [discard, setDiscard] = useState(false);
  const {
    sheet,
    pending,
    failure,
    title,
    uncertain,
    writable,
    notice,
    open,
    close,
    run,
  } = management;
  const retryReady = useWorkspaceRetryReady(failure?.error, failure?.at ?? 0);
  if (!sheet) return null;
  const kind = sheet.kind;
  const card = 'card' in sheet ? sheet.card : undefined;
  const editing = kind === 'create' || kind === 'rename';
  const reviewing = !!uncertain && (kind === 'create' || kind === 'duplicate');
  const uncertainMove =
    kind === 'move' && isUncertainColumnWrite(failure?.error);
  const blocked = pending || !retryReady || reviewing || uncertainMove;
  const heading =
    kind === 'actions'
      ? card!.title
      : (
          {
            board: 'Board actions',
            archived: 'Archived cards',
            create: 'Add card',
            rename: 'Rename card',
            move: 'Move to…',
            duplicate: 'Duplicate card',
            archive: 'Archive card?',
            restore: 'Restore card?',
          } as const
        )[kind];
  const requestDismiss = () => {
    if (discard) setDiscard(false);
    else if (
      editing &&
      !reviewing &&
      title !== (kind === 'rename' ? card!.title : '')
    )
      setDiscard(true);
    else close();
  };
  return (
    <BottomSheet
      visible
      title={discard ? 'Discard changes?' : heading}
      onDismiss={requestDismiss}
      dismissLabel="Dismiss card sheet"
      dismissible={!pending}
      showHandle
      respectReducedMotion
    >
      {discard ? (
        <>
          <Button
            label="Discard changes"
            variant="destructive"
            onPress={close}
          />
          <Button
            label="Keep editing"
            variant="secondary"
            onPress={() => setDiscard(false)}
          />
        </>
      ) : (
        <>
          {failure && !reviewing && (
            <Text
              accessibilityLiveRegion="polite"
              style={[typography.body, { color: c.danger }]}
            >
              {cardActionMessage(failure.error)}
            </Text>
          )}
          {reviewing && (
            <>
              <Text
                accessibilityLiveRegion="polite"
                style={[typography.body, { color: c.danger }]}
              >
                The server may have created a card. Check the refreshed board
                and clear filters if needed.
              </Text>
              <Button
                label="Review board"
                variant="secondary"
                onPress={management.reviewBoard}
              />
              <Button
                label="I checked the board"
                variant="link"
                disabled={!uncertain?.reviewed}
                onPress={management.acknowledge}
              />
            </>
          )}
          {uncertainMove && (
            <Button label="Review board" variant="secondary" onPress={close} />
          )}
          {kind === 'board' && (
            <Button
              label="Archived cards"
              variant="secondary"
              onPress={() => open({ kind: 'archived' })}
            />
          )}
          {kind === 'archived' && (
            <>
              {!!notice && (
                <Text
                  accessibilityLiveRegion="polite"
                  style={[typography.body, { color: c.text }]}
                >
                  {notice}
                </Text>
              )}
              <ArchivedCardsList
                identity={identity}
                boardId={boardId}
                columns={columns}
                onOpen={onOpenCard}
                onRestore={
                  writable
                    ? (card) => open({ kind: 'restore', card })
                    : undefined
                }
              />
            </>
          )}
          {editing && (
            <>
              {kind === 'create' && (
                <Text style={[typography.body, { color: c.textSecondary }]}>
                  {sheet.column.name}
                </Text>
              )}
              <TextField
                label="Card title"
                value={title}
                autoFocus={!reviewing}
                editable={!pending && !reviewing}
                onChangeText={management.edit}
              />
              <Button
                label={kind === 'create' ? 'Create card' : 'Save title'}
                loading={pending}
                disabled={blocked}
                onPress={() => {
                  if (kind === 'create')
                    void run({
                      kind,
                      input: { columnId: sheet.column.id, title },
                    });
                  else if (title.trim() === card!.title) close();
                  else
                    void run({
                      kind: 'update',
                      id: card!.id,
                      patch: { title },
                      expectedTitle: card!.title,
                    });
                }}
              />
            </>
          )}
          {kind === 'actions' && card && (
            <>
              <Button
                label="Rename"
                variant="secondary"
                onPress={() => open({ kind: 'rename', card })}
              />
              <Button
                label="Move to…"
                variant="secondary"
                onPress={() => open({ kind: 'move', card })}
              />
              <Button
                label="Duplicate"
                variant="secondary"
                onPress={() => open({ kind: 'duplicate', card })}
              />
              <Button
                label="Archive"
                variant="secondary"
                onPress={() => open({ kind: 'archive', card })}
              />
            </>
          )}
          {kind === 'duplicate' && (
            <Text style={[typography.body, { color: c.textSecondary }]}>
              Copies the title, description, dates, labels and checklists with
              items unchecked. Assignees, comments, activity and attachments
              stay with the original.
            </Text>
          )}
          {(kind === 'move' || kind === 'duplicate') && card && (
            <>
              <CardDestination
                key={kind}
                identity={identity}
                boardId={boardId}
                card={card}
                columns={columns}
                allowPrecision={allowPrecision}
                management={management}
                duplicate={kind === 'duplicate'}
                blocked={blocked}
              />
              {onLoadColumns && (
                <Button
                  label="Load more columns"
                  variant="link"
                  loading={columnsPending}
                  disabled={pending}
                  onPress={onLoadColumns}
                />
              )}
            </>
          )}
          {(kind === 'archive' || kind === 'restore') && card && (
            <>
              <Text style={[typography.body, { color: c.text }]}>
                {kind === 'archive'
                  ? `Archive “${card.title}”? You can restore it from Archived cards.`
                  : `Restore “${card.title}” to the end of its original column?`}
              </Text>
              <Button
                label={kind === 'archive' ? 'Archive card' : 'Restore card'}
                loading={pending}
                disabled={blocked}
                onPress={() => void run({ kind, id: card.id })}
              />
            </>
          )}
          <Button
            label={kind === 'archived' || kind === 'board' ? 'Close' : 'Cancel'}
            variant="link"
            disabled={pending}
            onPress={requestDismiss}
          />
        </>
      )}
    </BottomSheet>
  );
}
