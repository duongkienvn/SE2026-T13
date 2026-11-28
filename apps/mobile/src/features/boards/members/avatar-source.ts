import { isUuid } from '../../../infrastructure/auth/credential-record.ts';

/**
 * Backend-managed avatar identity: `/users/<the same user id>/avatar/<asset uuid>`.
 * Anything else (another user's path, traversal, query, encoded or control
 * characters) is not a managed avatar.
 */
export function managedAvatarPath(value: unknown, userId: string) {
  if (typeof value !== 'string' || /[\p{Cc}%?#\\\s]/u.test(value)) return null;
  const parts = value.split('/');
  return parts.length === 5 &&
    parts[0] === '' &&
    parts[1] === 'users' &&
    parts[2] === userId &&
    parts[3] === 'avatar' &&
    isUuid(parts[4])
    ? value
    : null;
}

/** Legacy external photo: plain HTTPS, no embedded credentials. Never authenticated. */
export function externalAvatarUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function avatarRevision(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

export function avatarDataUri(bytes: Uint8Array) {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const bits =
      (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    encoded +=
      alphabet[(bits >>> 18) & 63]! +
      alphabet[(bits >>> 12) & 63]! +
      (i + 1 < bytes.length ? alphabet[(bits >>> 6) & 63]! : '=') +
      (i + 2 < bytes.length ? alphabet[bits & 63]! : '=');
  }
  return `data:image/webp;base64,${encoded}`;
}
