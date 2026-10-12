import type { CursorPaginationMeta } from '@kanban/shared';

export const CURSOR_RESULT = Symbol('cursorResult');

export interface CursorResult<T> {
  readonly [CURSOR_RESULT]: true;
  data: T[];
  meta: CursorPaginationMeta;
}

export function cursorResult<T>(
  data: T[],
  limit: number,
  nextCursor: string | null,
): CursorResult<T> {
  const result = { data, meta: { limit, nextCursor } } as CursorResult<T>;
  Object.defineProperty(result, CURSOR_RESULT, { value: true });
  return result;
}
