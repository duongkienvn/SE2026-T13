import { useSortable } from '@dnd-kit/sortable';
import type { KeyboardEventHandler } from 'react';
import type { MemberUser } from '../../board-members/types';
import { cardDragId } from '../../boards/kanban-layout';
import type { Card } from '../types';
import { KanbanCard } from './KanbanCard';

interface SortableCardProps {
  card: Card;
  members: ReadonlyMap<string, MemberUser>;
  onOpen: (card: Card) => void;
  /** Read-only board, or a move is still saving. */
  dragDisabled: boolean;
}

/**
 * A card that can be dragged: with the mouse or touch from anywhere on it,
 * with the keyboard from its grip button only (so Enter on the title still
 * opens the card).
 */
export function SortableCard({
  card,
  members,
  onOpen,
  dragDisabled,
}: SortableCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: cardDragId(card.id),
    data: { type: 'card', columnId: card.columnId },
    disabled: dragDisabled,
  });
  const { pointerListeners, onKeyDown } = splitDragListeners(listeners);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform
          ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
          : undefined,
        transition,
      }}
      className={`touch-manipulation ${isDragging ? 'opacity-40' : ''}`}
      {...pointerListeners}
    >
      <KanbanCard
        card={card}
        members={members}
        onOpen={onOpen}
        dragHandle={
          dragDisabled ? undefined : (
            <button
              ref={setActivatorNodeRef}
              {...attributes}
              onKeyDown={onKeyDown}
              aria-label={`Move card ${card.title}`}
              className={`relative z-10 -m-1 grid size-6 shrink-0 cursor-grab place-items-center rounded text-muted/70 hover:bg-app hover:text-ink focus-visible:outline-2 focus-visible:outline-primary ${GRIP_REVEAL}`}
            >
              <GripIcon />
            </button>
          )
        }
      />
    </div>
  );
}

/**
 * With a mouse, grips appear on hover or keyboard focus only, like the
 * approved design; touch screens (no hover) always show them.
 */
export const GRIP_REVEAL =
  'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100';

/**
 * Mouse and touch listeners go on the whole item, the keyboard one on its
 * grip only: dnd-kit ignores keys pressed anywhere but the activator node.
 */
export function splitDragListeners(
  listeners: ReturnType<typeof useSortable>['listeners'],
) {
  const { onKeyDown, ...pointerListeners } = listeners ?? {};
  return {
    pointerListeners,
    onKeyDown: onKeyDown as KeyboardEventHandler<HTMLElement> | undefined,
  };
}

export function GripIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="currentColor"
    >
      {[3, 8, 13].map((y) =>
        [5.5, 10.5].map((x) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={1.4} />
        )),
      )}
    </svg>
  );
}
