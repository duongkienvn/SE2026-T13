export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
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
  return {
    data,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export interface PageQuery {
  page: number;
  limit: number;
}

export function pageOffset(query: PageQuery): number {
  return (query.page - 1) * query.limit;
}
