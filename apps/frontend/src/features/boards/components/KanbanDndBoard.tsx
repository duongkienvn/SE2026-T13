import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Alert } from '../../../components/Alert';
import {
  BOARD_ARCHIVED,
  ClientErrorCode,
  isApiError,
} from '../../../lib/api-client';
import { toFormErrors } from '../../../lib/form-errors';
import type { MemberUser } from '../../board-members/types';
import { KanbanCard } from '../../cards/components/KanbanCard';
import { CARD_ARCHIVED, useMoveCard } from '../../cards/hooks';
import type { Card } from '../../cards/types';
import {
  KanbanColumn,
  type ColumnActions,
} from '../../columns/components/KanbanColumn';
import { useMoveColumn } from '../../columns/hooks';
import type { Column } from '../../columns/types';
import {
  arrayMove,
  cardMoveRequest,
  columnDragId,
  columnMoveRequest,
  findCardColumn,
  parseDragId,
  placeCard,
  type KanbanLayout,
} from '../kanban-layout';

interface KanbanDndBoardProps {
  boardId: string;
  groups: { column: Column; cards: Card[] }[];
  members: ReadonlyMap<string, MemberUser>;
  /** Left out on a read-only board, which also turns dragging off. */
  actions?: ColumnActions;
  onOpenCard: (card: Card) => void;
  /** Shown after the last column (the "Add column" tile). */
  trailing?: ReactNode;
}

const isType = (type: 'column' | 'card') => (id: UniqueIdentifier) =>
  parseDragId(id)?.type === type;

/**
 * Prefer the card under the pointer; otherwise the column under it, so a card
 * can be dropped into an empty column or below the last card. Columns only
 * ever collide with columns.
 */
function findTarget(
  args: Parameters<CollisionDetection>[0],
  /** The column the dragged card is in right now (in the preview). */
  ownColumnId: string | undefined,
): UniqueIdentifier | null {
  if (isType('column')(args.active.id)) {
    return (
      closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) =>
          isType('column')(c.id),
        ),
      })[0]?.id ?? null
    );
  }
  const pointer = pointerWithin(args);
  const hits = pointer.length > 0 ? pointer : rectIntersection(args);
  const cardHits = new Set(
    hits
      .filter((hit) => isType('card')(hit.id) && hit.id !== args.active.id)
      .map((hit) => hit.id),
  );
  if (cardHits.size > 0) {
    return (
      closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) =>
          cardHits.has(c.id),
        ),
      })[0]?.id ?? null
    );
  }
  const column = hits.find((hit) => isType('column')(hit.id))?.id ?? null;
  // In the gap between two cards of its own column, keep the last card as
  // the target instead of snapping everything back.
  if (column !== null && parseDragId(column)?.id === ownColumnId) return null;
  return column;
}

function moveErrorMessage(error: unknown): string {
  // A card or column (or the anchor) moved or vanished meanwhile.
  if (
    isApiError(error) &&
    (error.status === 404 ||
      error.status === 400 ||
      error.code === CARD_ARCHIVED)
  ) {
    return 'The board changed while you were moving that. It now shows the latest order.';
  }
  if (isApiError(error) && error.code === BOARD_ARCHIVED) {
    return toFormErrors(error, {}).formError!;
  }
  if (isApiError(error) && error.code === ClientErrorCode.NETWORK_ERROR) {
    return `${error.message} The board shows the last saved order.`;
  }
  return 'The move couldn’t be saved, so the board shows the last saved order. Please try again.';
}

export function KanbanDndBoard({
  boardId,
  groups,
  members,
  actions,
  onOpenCard,
  trailing,
}: KanbanDndBoardProps) {
  const moveCard = useMoveCard(boardId);
  const moveColumn = useMoveColumn(boardId);
  // While dragging and until the move is saved, the board shows this order
  // instead of the server's. Dropping it is the rollback.
  const [preview, setPreview] = useState<KanbanLayout | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const saving = moveCard.isPending || moveColumn.isPending;
  const dragDisabled = !actions || saving;

  const serverLayout = useMemo<KanbanLayout>(
    () => ({
      columns: groups.map((group) => group.column.id),
      cards: Object.fromEntries(
        groups.map((group) => [
          group.column.id,
          group.cards.map((card) => card.id),
        ]),
      ),
    }),
    [groups],
  );
  const columnsById = useMemo(
    () => new Map(groups.map((group) => [group.column.id, group.column])),
    [groups],
  );
  const cardsById = useMemo(
    () => new Map(groups.flatMap((group) => group.cards.map((c) => [c.id, c]))),
    [groups],
  );
  const layout = preview ?? serverLayout;

  // Moving a card into another column shifts the layout under the pointer,
  // which can flip the target back and forth forever. As in dnd-kit's
  // multi-container example, keep the last target until the layout settled.
  const lastTarget = useRef<UniqueIdentifier | null>(null);
  const justMoved = useRef(false);
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
    const frame = requestAnimationFrame(() => {
      justMoved.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [layout]);
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const dragged = parseDragId(args.active.id);
    const ownColumnId =
      dragged?.type === 'card'
        ? findCardColumn(layoutRef.current, dragged.id)
        : undefined;
    const target = justMoved.current ? null : findTarget(args, ownColumnId);
    if (target !== null) {
      lastTarget.current = target;
    } else if (justMoved.current || lastTarget.current === null) {
      lastTarget.current = args.active.id;
    }
    return [{ id: lastTarget.current }];
  }, []);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const nameOf = (id: UniqueIdentifier | undefined): string => {
    const parsed = id === undefined ? null : parseDragId(id);
    if (!parsed) return 'nothing';
    return parsed.type === 'column'
      ? `column ${columnsById.get(parsed.id)?.name ?? ''}`
      : `card ${cardsById.get(parsed.id)?.title ?? ''}`;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${nameOf(active.id)} is over ${nameOf(over.id)}.`
        : `${nameOf(active.id)} is no longer over a drop area.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped ${nameOf(active.id)}.`
        : `${nameOf(active.id)} was dropped outside the board and stays in place.`,
    onDragCancel: ({ active }) =>
      `Moving ${nameOf(active.id)} was cancelled. It stays in place.`,
  };

  const reset = () => {
    setPreview(null);
    setActiveId(null);
  };

  const save = (run: () => Promise<unknown>) => {
    setActiveId(null);
    run()
      .then(() => setPreview(null))
      .catch((failure: unknown) => {
        setPreview(null);
        setError(moveErrorMessage(failure));
      });
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    lastTarget.current = null;
    setError(undefined);
    setActiveId(String(active.id));
    setPreview(serverLayout);
  };

  /** Moves a dragged card into the column it is over, as a preview. */
  const onDragOver = ({ active, over }: DragOverEvent) => {
    const dragged = parseDragId(active.id);
    const target = over ? parseDragId(over.id) : null;
    if (dragged?.type !== 'card' || !target || !over) return;
    const dragTop = active.rect.current.translated?.top ?? 0;
    const below = dragTop > over.rect.top + over.rect.height / 2;

    // Work from the latest preview: several events can arrive per render.
    setPreview((current) => {
      if (!current) return current;
      const from = findCardColumn(current, dragged.id);
      const to =
        target.type === 'column'
          ? target.id
          : findCardColumn(current, target.id);
      if (!from || !to || from === to) return current;
      const index =
        target.type === 'card'
          ? current.cards[to].indexOf(target.id) + (below ? 1 : 0)
          : current.cards[to].length;
      justMoved.current = true;
      return placeCard(current, dragged.id, to, index);
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const dragged = parseDragId(active.id);
    const target = over ? parseDragId(over.id) : null;
    if (!preview || !dragged || !target) return reset();

    if (dragged.type === 'column') {
      const overColumn =
        target.type === 'column'
          ? target.id
          : findCardColumn(preview, target.id);
      const order = overColumn
        ? arrayMove(
            preview.columns,
            preview.columns.indexOf(dragged.id),
            preview.columns.indexOf(overColumn),
          )
        : preview.columns;
      const request = columnMoveRequest(
        serverLayout.columns,
        order,
        dragged.id,
      );
      if (!request) return reset();
      setPreview({ ...preview, columns: order });
      return save(() =>
        moveColumn.mutateAsync({ columnId: dragged.id, ...request }),
      );
    }

    let final = preview;
    const column = findCardColumn(preview, dragged.id);
    if (column && target.type === 'card' && target.id !== dragged.id) {
      const index = preview.cards[column].indexOf(target.id);
      if (index !== -1) final = placeCard(preview, dragged.id, column, index);
    }
    const request = cardMoveRequest(serverLayout, final, dragged.id);
    if (!request) return reset();
    setPreview(final);
    save(() => moveCard.mutateAsync({ cardId: dragged.id, ...request }));
  };

  const active = activeId ? parseDragId(activeId) : null;
  const activeCard =
    active?.type === 'card' ? cardsById.get(active.id) : undefined;
  const activeColumn =
    active?.type === 'column' ? columnsById.get(active.id) : undefined;

  return (
    <div className="flex h-full flex-col gap-3">
      {error && <Alert variant="error">{error}</Alert>}
      {saving && (
        <p role="status" className="sr-only">
          Saving the new order…
        </p>
      )}
      <div className="relative -mx-4 min-h-0 flex-1 overflow-x-auto px-4 md:-mx-6 md:px-6 lg:-mx-10 lg:px-10">
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                'To move a card or column, press Space on its grip, use the arrow keys to move it, then press Space to drop it or Escape to cancel.',
            },
          }}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={reset}
        >
          <div className="flex h-full items-start gap-4 pb-1">
            <SortableContext
              items={layout.columns.map(columnDragId)}
              strategy={horizontalListSortingStrategy}
            >
              {layout.columns.map((columnId) => {
                const column = columnsById.get(columnId);
                if (!column) return null;
                const columnCards = (layout.cards[columnId] ?? [])
                  .map((id) => cardsById.get(id))
                  .filter((card): card is Card => !!card);
                return (
                  <KanbanColumn
                    key={columnId}
                    column={column}
                    cards={columnCards}
                    members={members}
                    actions={actions}
                    onOpenCard={onOpenCard}
                    dragDisabled={dragDisabled}
                  />
                );
              })}
            </SortableContext>
            {trailing}
          </div>
          {/* No rotate/scale: the overlay's box is what keyboard moves measure. */}
          <DragOverlay>
            {activeCard ? (
              <div className="w-64 cursor-grabbing rounded-lg shadow-frame ring-2 ring-primary/30">
                <KanbanCard card={activeCard} members={members} />
              </div>
            ) : activeColumn ? (
              <div className="w-70 cursor-grabbing rounded-xl bg-line px-4 py-4 shadow-frame">
                <p className="text-[17px] font-semibold text-ink">
                  {activeColumn.name}
                </p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
