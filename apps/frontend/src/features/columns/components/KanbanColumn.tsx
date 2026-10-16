import { useId } from 'react';
import { ActionMenu } from '../../../components/ActionMenu';
import type { MemberUser } from '../../board-members/types';
import { KanbanCard } from '../../cards/components/KanbanCard';
import type { Card } from '../../cards/types';
import type { Column } from '../types';

/** Column actions; left out on a read-only (archived) board. */
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
}

export function KanbanColumn({
  column,
  cards,
  members,
  actions,
}: KanbanColumnProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="relative flex max-h-full w-70 shrink-0 flex-col rounded-xl bg-line/45"
    >
      <header className="flex items-center gap-2 px-4 pt-4 pb-3">
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
          <ActionMenu
            label={`Actions for column ${column.name}`}
            className="-mr-2 ml-auto"
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
        )}
      </header>
      {/* `relative` keeps screen-reader-only text inside the scroll area. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {cards.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-sm text-muted">
            No cards yet
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {cards.map((card) => (
              <li key={card.id}>
                <KanbanCard card={card} members={members} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
