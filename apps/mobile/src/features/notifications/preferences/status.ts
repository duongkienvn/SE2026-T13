import { ApiError } from '../../../infrastructure/api/errors.ts';
export function preferencesError(error: unknown, saving = false) {
  if (error instanceof ApiError) {
    if (error.status === 400)
      return 'The server rejected these preference changes. Only supported on/off choices can be saved.';
    if (error.status === 429)
      return 'Too many requests. Wait before trying again.';
    if (
      error.status === 401 ||
      error.kind === 'unauthenticated' ||
      error.kind === 'session-changed'
    )
      return 'Your session changed. Sign in again to continue.';
    if (error.kind === 'invalid-response')
      return 'The server returned invalid notification preferences. Retry to load supported values.';
  }
  return saving
    ? 'Couldn’t confirm your changes. Your draft is still here.'
    : 'Couldn’t load notification preferences. Try again.';
}
