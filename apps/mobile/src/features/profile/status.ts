import { ApiError } from '../../infrastructure/api/errors.ts';
/** Never render a server/SDK exception message in account forms. */
export function profileError(error: unknown) {
  if (!(error instanceof ApiError))
    return 'The operation could not be confirmed. Please try again.';
  if (error.code === 'PHOTO_PICKER_UNAVAILABLE')
    return 'Photo selection is unavailable or permission was denied. You can keep your current photo or choose again when access is available.';
  if (error.code === 'PRIVATE_STORAGE_FAILED')
    return 'Private photo storage is unavailable. Check device storage and restart the app.';
  if (error.kind === 'offline')
    return 'You’re offline. Reconnect before trying again.';
  if (error.kind === 'timeout' || error.kind === 'network')
    return 'The result was not confirmed. Check the server status before trying again.';
  if (error.kind === 'aborted') return 'The operation was canceled.';
  if (error.status === 400)
    return 'Check the name or selected photo and try again.';
  if (error.status === 409)
    return error.code === 'AVATAR_UPLOAD_EXPIRED'
      ? 'The photo upload expired. Choose your photo again.'
      : 'Your profile or photo changed. Refresh and review the current values before trying again.';
  if (error.status === 413)
    return 'Choose a nonempty photo no larger than 5 MiB.';
  if ([415, 422].includes(error.status))
    return 'Choose a valid JPEG, PNG or WebP photo of at most 16 million pixels.';
  if (error.status === 429)
    return 'Too many attempts. Please wait before trying again.';
  if (error.status === 503)
    return 'Private photo storage or verification is unavailable. Try again later.';
  if ([401, 403, 404].includes(error.status))
    return 'This account resource is unavailable. Refresh or sign in again.';
  return 'The service is unavailable. Please try again later.';
}
