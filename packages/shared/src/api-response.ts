export interface ApiSuccessResponse<T> {
  success: true;
  statusCode: number;
  message: string;
  data: T;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiPaginatedResponse<T> extends ApiSuccessResponse<T[]> {
  meta: PaginationMeta;
}

export interface CursorPaginationMeta {
  limit: number;
  nextCursor: string | null;
}

export interface ApiCursorPaginatedResponse<T> extends ApiSuccessResponse<T[]> {
  meta: CursorPaginationMeta;
}

export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  code: string;
  message: string;
  timestamp: string;
  path: string;
  details?: string[];
  requestId?: string;
}
