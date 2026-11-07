import { boardKeys } from '../boards/query-keys';
import { invalidationTargets } from '../realtime/event-invalidation';
import { describe, expect, it } from 'vitest';
import { filterSearchParams, parseBoardFilters } from './board-filter';

describe('board filter URL parsing', () => {
  it('normalizes facets and ignores unrelated or invalid values', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(
      parseBoardFilters(
        new URLSearchParams(
          `q=%20hello%20&labelIds=${id},${id},bad&dueStatus=OVERDUE&unrelated=x`,
        ),
      ),
    ).toEqual({ q: 'hello', labelIds: [id], dueStatus: 'OVERDUE' });
  });
  it('only includes canonical filter fields in shared links', () => {
    const filters = parseBoardFilters(
      new URLSearchParams('q=hello&token=secret&dueStatus=UPCOMING'),
    );
    expect(filterSearchParams(filters).toString()).toBe(
      'q=hello&dueStatus=UPCOMING',
    );
  });
  it('rejects invalid ranges and dates without an explicit offset', () => {
    expect(
      parseBoardFilters(
        new URLSearchParams(
          'dueFrom=2026-01-02T00%3A00%3A00Z&dueTo=2026-01-01T00%3A00%3A00Z',
        ),
      ),
    ).toEqual({});
    expect(
      parseBoardFilters(new URLSearchParams('dueFrom=2026-01-01')),
    ).toEqual({});
    expect(
      parseBoardFilters(
        new URLSearchParams('dueFrom=2026-02-30T00%3A00%3A00Z'),
      ),
    ).toEqual({});
  });
});

describe('preview invalidation', () => {
  it('refreshes filtered pages and summaries on a card update and summaries on comments', () => {
    const prefix = boardKeys.cards('board');
    const targets = invalidationTargets('card:updated', {
      boardId: 'board',
      cardId: 'card',
      columnId: 'column',
    });
    expect(targets).toContainEqual({ queryKey: [...prefix, 'filtered'] });
    expect(targets).toContainEqual({
      queryKey: [...prefix, 'preview-summaries'],
      previewCardId: 'card',
    });
    expect(
      invalidationTargets('comment:created', {
        boardId: 'board',
        cardId: 'card',
        commentId: 'comment',
      }),
    ).toContainEqual({
      queryKey: [...prefix, 'preview-summaries'],
      previewCardId: 'card',
    });
  });
});
