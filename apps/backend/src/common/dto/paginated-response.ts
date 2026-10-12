import type { PaginationMeta } from '@kanban/shared';

export type { PaginationMeta };

export const PAGINATED_RESULT = Symbol('paginatedResult');

export interface PaginatedResponse<T> {
  readonly [PAGINATED_RESULT]: true;
  data: T[];
  meta: PaginationMeta;
}

export function paginate<T>(
  data: T[],
  total: number,
  query: PageQuery,
): PaginatedResponse<T> {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError('total must be a non-negative integer');
  }
  const result = {
    data,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  } as PaginatedResponse<T>;
  Object.defineProperty(result, PAGINATED_RESULT, { value: true });
  return result;
}

export interface PageQuery {
  page: number;
  limit: number;
}

export function pageOffset(query: PageQuery): number {
  const offset = (query.page - 1) * query.limit;
  if (
    !Number.isSafeInteger(query.page) ||
    query.page < 1 ||
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    !Number.isSafeInteger(offset)
  ) {
    throw new RangeError('Pagination offset must be a safe integer');
  }
  return offset;
}
