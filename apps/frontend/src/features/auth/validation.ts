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
  const length = passwordLength(value);
  if (length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (length > PASSWORD_MAX_LENGTH)
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  const missing = newPasswordRequirements(value).find((rule) => !rule.met);
  if (missing) return missing.message;
  return undefined;
}

/** Match class-validator / validator.js isLength, including Unicode symbols. */
export function passwordLength(value: string): number {
  const presentationSequences =
    value.match(/[^\uFE0F\uFE0E][\uFE0F\uFE0E]/g) ?? [];
  const surrogatePairs = value.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) ?? [];
  return value.length - presentationSequences.length - surrogatePairs.length;
}

/** Registration only. Login must continue to accept existing credentials. */
export function newPasswordRequirements(value: string) {
  return [
    {
      label: 'At least 8 characters',
      met: passwordLength(value) >= PASSWORD_MIN_LENGTH,
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    },
    {
      label: 'One uppercase letter',
      met: /[A-Z]/.test(value),
      message: 'Password must contain an uppercase letter (A–Z).',
    },
    {
      label: 'One number',
      met: /[0-9]/.test(value),
      message: 'Password must contain a number (0–9).',
    },
    {
      label: 'One special character',
      met: /[\p{P}\p{S}]/u.test(value),
      message:
        'Password must contain a special character (punctuation or symbol, not whitespace).',
    },
  ];
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
