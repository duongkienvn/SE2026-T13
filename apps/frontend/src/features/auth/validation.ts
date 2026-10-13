/*
 * Client-side checks mirroring the Backend Authentication DTO rules.
 * They give early feedback only; the backend stays the source of truth.
 */

export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 80;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validateEmail(value: string): string | undefined {
  const email = normalizeEmail(value);
  if (!email) return 'Enter your email address.';
  if (email.length > EMAIL_MAX_LENGTH)
    return `Email must be at most ${EMAIL_MAX_LENGTH} characters.`;
  if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address.';
  return undefined;
}

export function validateNewPassword(value: string): string | undefined {
  if (!value) return 'Enter a password.';
  if (value.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (value.length > PASSWORD_MAX_LENGTH)
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  return undefined;
}

export function validateDisplayName(value: string): string | undefined {
  const name = value.trim();
  if (name.length < DISPLAY_NAME_MIN_LENGTH)
    return `Display name must be at least ${DISPLAY_NAME_MIN_LENGTH} characters.`;
  if (name.length > DISPLAY_NAME_MAX_LENGTH)
    return `Display name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters.`;
  return undefined;
}

/** Empty input means "no avatar" (`null`); otherwise an HTTPS URL is required. */
export function validateAvatarUrl(value: string): string | undefined {
  const url = value.trim();
  if (!url) return undefined;
  try {
    if (new URL(url).protocol === 'https:') return undefined;
  } catch {
    // Not a URL at all.
  }
  return 'Enter a valid HTTPS image URL, or leave it empty.';
}

export function hasErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some(Boolean);
}
