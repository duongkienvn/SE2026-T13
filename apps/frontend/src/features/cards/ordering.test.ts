import { describe, expect, it } from 'vitest';
import { makeCard, makeColumn } from '../../test/board-fixtures';
import { groupCardsByColumn } from './ordering';

describe('groupCardsByColumn', () => {
  it('sorts columns and their cards by position', () => {
    const todo = makeColumn({ position: '200.0000000000' });
    const backlog = makeColumn({ position: '100.0000000000' });
    const second = makeCard({ columnId: todo.id, position: '20.0000000000' });
    const first = makeCard({ columnId: todo.id, position: '10.0000000000' });
    const only = makeCard({ columnId: backlog.id });

    const groups = groupCardsByColumn([todo, backlog], [second, only, first]);

    expect(groups.map((g) => g.column.id)).toEqual([backlog.id, todo.id]);
    expect(groups[0].cards).toEqual([only]);
    expect(groups[1].cards).toEqual([first, second]);
  });

  it('keeps empty columns and leaves out unknown columns and archived cards', () => {
    const column = makeColumn();
    const archived = makeCard({ columnId: column.id, isArchived: true });
    const orphan = makeCard({ columnId: 'gone' });

    const groups = groupCardsByColumn([column], [archived, orphan]);

    expect(groups).toEqual([{ column, cards: [] }]);
  });
});
