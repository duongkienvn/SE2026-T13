import { ApiError } from '../../../infrastructure/api/errors.ts';
export function scheduleError(error: unknown, saving = false) {
  if (error instanceof ApiError) {
    if (error.status === 400)
      return 'Check the quiet-hours times. Use 15-minute steps and different start and end times when enabled.';
    if (error.status === 404)
      return 'Quiet hours are unavailable on this server. No schedule can be confirmed here.';
    if (error.status === 429)
      return 'Too many requests. Wait before trying again.';
    if (
      error.status === 401 ||
      ['unauthenticated', 'session-changed'].includes(error.kind)
    )
      return 'Your session changed. Sign in again to continue.';
    if (error.kind === 'offline')
      return 'You’re offline. Reconnect to load or save quiet hours.';
  }
  return saving
    ? 'Couldn’t confirm your changes. Your draft is still here.'
    : 'Couldn’t load quiet hours. Try again.';
}
