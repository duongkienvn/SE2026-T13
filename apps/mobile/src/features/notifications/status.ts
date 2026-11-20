import { ApiError } from '../../infrastructure/api/errors.ts';
export function inboxErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429)
      return 'Too many requests. Wait before trying again.';
    if (error.status === 404)
      return 'That notification is no longer available. Refresh your Inbox.';
    if (error.status === 403 || error.kind === 'session-changed')
      return 'Access changed. Refresh your Inbox to check what’s available.';
    if (error.kind === 'timeout')
      return 'The request took too long. Try again.';
    if (error.kind === 'network' || error.kind === 'offline')
      return 'Couldn’t connect. Check your connection and try again.';
  }
  return 'Couldn’t verify the latest Inbox. Try again.';
}
