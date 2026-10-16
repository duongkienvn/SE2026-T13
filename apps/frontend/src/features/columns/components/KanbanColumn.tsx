import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useId, useState, type SyntheticEvent } from 'react';
import { ActionMenu } from '../../../components/ActionMenu';
import { PlusIcon } from '../../../components/icons';
import type { MemberUser } from '../../board-members/types';
import { cardDragId, columnDragId } from '../../boards/kanban-layout';
import { AddCardForm } from '../../cards/components/AddCardForm';
import {
  GRIP_REVEAL,
  GripIcon,
  SortableCard,
  splitDragListeners,
} from '../../cards/components/SortableCard';
import type { Card } from '../../cards/types';
import type { Column } from '../types';

/** Column and card changes; left out on a read-only (archived) board. */
export interface ColumnActions {
  onRename: (column: Column) => void;
  onDelete: (column: Column) => void;
}

interface KanbanColumnProps {
  column: Column;
  /** The column's active cards, already in order. */
  cards: Card[];
  members: ReadonlyMap<string, MemberUser>;
  actions?: ColumnActions;
  onOpenCard: (card: Card) => void;
  /** Read-only board, or a move is still saving. */
  dragDisabled: boolean;
}

/** Keeps a press on a header button from starting a column drag. */
const stopDrag = (event: SyntheticEvent) => event.stopPropagation();

export function KanbanColumn({
  column,
  cards,
  members,
  actions,
  onOpenCard,
  dragDisabled,
}: KanbanColumnProps) {
  const headingId = useId();
  const [composing, setComposing] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: columnDragId(column.id),
    data: { type: 'column' },
    disabled: dragDisabled,
  });
  const { pointerListeners, onKeyDown } = splitDragListeners(listeners);

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      style={{
        transform: transform
          ? `translate3d(${Math.round(transform.x)}px, 0, 0)`
          : undefined,
        transition,
      }}
      className={`relative flex max-h-full w-70 shrink-0 flex-col rounded-xl bg-line/45 ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <header
        className={`group relative flex touch-manipulation items-center gap-2 pt-4 pr-4 pb-3 pl-6 ${
          dragDisabled ? '' : 'cursor-grab'
        }`}
        {...pointerListeners}
      >
        {!dragDisabled && (
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            onKeyDown={onKeyDown}
            aria-label={`Move column ${column.name}`}
            className={`absolute top-5 left-0.5 grid size-5 place-items-center rounded text-muted/70 hover:bg-app hover:text-ink focus-visible:outline-2 focus-visible:outline-primary ${GRIP_REVEAL}`}
          >
            <GripIcon />
          </button>
        )}
        <h2
          id={headingId}
          className="min-w-0 truncate text-[17px] font-semibold text-ink"
        >
          {column.name}
        </h2>
        <span className="text-[17px] text-muted">
          <span className="sr-only">, </span>
          {cards.length}
          <span className="sr-only">
            {' '}
            {cards.length === 1 ? 'card' : 'cards'}
          </span>
        </span>
        {actions && (
          <div
            className="-mr-2 ml-auto flex cursor-default items-center"
            onMouseDown={stopDrag}
            onTouchStart={stopDrag}
          >
            <button
              type="button"
              aria-label={`Add a card to ${column.name}`}
              onClick={() => setComposing(true)}
              className="grid size-8 place-items-center rounded-lg text-muted hover:bg-app hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
            >
              <PlusIcon aria-hidden="true" className="size-4.5" />
            </button>
            <ActionMenu
              label={`Actions for column ${column.name}`}
              items={[
                {
                  label: 'Rename column',
                  onSelect: () => actions.onRename(column),
                },
                {
                  label: 'Delete column',
                  tone: 'danger',
                  onSelect: () => actions.onDelete(column),
                  disabledReason:
                    cards.length > 0
                      ? 'Move or archive its cards first.'
                      : undefined,
                },
              ]}
            />
          </div>
        )}
      </header>
      {/* `relative` keeps screen-reader-only text inside the scroll area. */}
      <div className="relative min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
        <SortableContext
          items={cards.map((card) => cardDragId(card.id))}
          strategy={verticalListSortingStrategy}
        >
          {cards.length === 0 && !composing && (
            <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-sm text-muted">
              No cards yet
            </p>
          )}
          {cards.length > 0 && (
            <ol className="flex flex-col gap-3">
              {cards.map((card) => (
                <li key={card.id}>
                  <SortableCard
                    card={card}
                    members={members}
                    onOpen={onOpenCard}
                    dragDisabled={dragDisabled}
                  />
                </li>
              ))}
            </ol>
          )}
        </SortableContext>
        {actions &&
          (composing ? (
            <AddCardForm
              boardId={column.boardId}
              columnId={column.id}
              columnName={column.name}
              onClose={() => setComposing(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[15px] text-muted hover:bg-surface/70 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
            >
              <PlusIcon aria-hidden="true" className="size-4.5" />
              New card
            </button>
          ))}
      </div>
    </section>
  );
}
