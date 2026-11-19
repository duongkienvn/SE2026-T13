import { ApiError } from '../../infrastructure/api/errors.ts';

export function searchErrorMessage(error: unknown, nextPage: boolean) {
  if (error instanceof ApiError) {
    if (error.status === 429)
      return 'Too many requests. Wait before trying again.';
    if (error.status === 400)
      return 'Search could not be accepted. Check your query and try again.';
    if (
      [401, 403, 404].includes(error.status) ||
      error.kind === 'session-changed'
    )
      return 'Search access changed. Retry to check what’s available.';
    if (error.kind === 'timeout') return 'Search took too long. Try again.';
    if (error.kind === 'network' || error.kind === 'offline')
      return 'Search couldn’t connect. Check your connection and try again.';
  }
  return nextPage
    ? 'Couldn’t load more results. Your loaded results are below.'
    : 'Couldn’t verify search results. Retry to check what’s available.';
}
