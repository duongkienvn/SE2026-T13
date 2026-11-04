import { describe, expect, it } from 'vitest';
import { normalizeTaskSearch, parseTaskSearch } from './search';

describe('task URL filters', () => {
  it('restores group, page, sort and board-scoped labels', () => {
    const board = '22222222-2222-4222-8222-222222222222';
    const label = '55555555-5555-4555-8555-555555555555';
    expect(
      parseTaskSearch(
        new URLSearchParams({
          group: 'LATER',
          page: '3',
          sort: 'board',
          boardId: board,
          labelIds: label,
          dueFrom: '2026-03-08',
          dueTo: '2026-03-09',
        }),
      ),
    ).toMatchObject({
      group: 'LATER',
      page: 3,
      sort: 'board',
      boardId: board,
      labelIds: label,
      dueFrom: '2026-03-08',
      dueTo: '2026-03-09',
    });
  });

  it('rejects unsafe page values, invalid dates and labels without a board', () => {
    expect(
      parseTaskSearch(
        new URLSearchParams({
          page: '999999999999999999999',
          dueFrom: '2026-02-30',
          labelIds: '55555555-5555-4555-8555-555555555555',
        }),
      ),
    ).toMatchObject({ page: 1, dueFrom: undefined, labelIds: undefined });
  });

  it('normalizes duplicate or invalid fields while preserving unrelated context', () => {
    const params = new URLSearchParams(
      'group=LATER&group=OVERDUE&page=0&dueFrom=2026-02-30&view=compact',
    );
    expect(normalizeTaskSearch(params).toString()).toBe('view=compact');
  });

  it('normalizes UUID case for matching authorized selector options', () => {
    const params = new URLSearchParams({
      boardId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    });
    expect(parseTaskSearch(params).boardId).toBe(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
  });
});
