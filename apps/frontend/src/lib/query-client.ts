import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './api-client';

export function createQueryClient(): QueryClient {
  return new QueryClient();
}

/** Query `retry` rule: don't retry errors waiting can't fix (401/403/404/409...). */
export function retryUnlessClientError(
  failureCount: number,
  error: unknown,
): boolean {
  if (isApiError(error) && error.status >= 400 && error.status < 500)
    return false;
  return failureCount < 2;
}
