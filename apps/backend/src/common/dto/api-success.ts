import type { ApiSuccessResponse } from '@kanban/shared';

const EXPLICIT_RESPONSE = Symbol('explicitApiResponse');

export type ExplicitApiSuccess<T> = ApiSuccessResponse<T> & {
  readonly [EXPLICIT_RESPONSE]: true;
};

export function apiSuccess<T>(
  data: T,
  statusCode = 200,
  message = 'OK',
): ExplicitApiSuccess<T> {
  return {
    [EXPLICIT_RESPONSE]: true,
    success: true,
    statusCode,
    message,
    data,
  };
}

export function isExplicitApiSuccess(
  value: unknown,
): value is ExplicitApiSuccess<unknown> {
  return (
    typeof value === 'object' && value !== null && EXPLICIT_RESPONSE in value
  );
}
