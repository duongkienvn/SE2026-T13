export const PASSWORD_HINT =
  '8–128 characters, including an uppercase letter (A–Z), a number (0–9), and punctuation or a symbol. Spaces do not count as symbols.';

export function emailError(value: string): string | undefined {
  const email = value.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
    return 'Enter a valid email address (up to 254 characters).';
}

export function passwordError(value: string, isNew = true): string | undefined {
  // class-validator counts Unicode code points, not UTF-16 code units.
  const length = Array.from(value).length;
  if (isNew) {
    if (
      length < 8 ||
      length > 128 ||
      !/^(?=.*[A-Z])(?=.*[0-9])(?=.*[\p{P}\p{S}])/su.test(value)
    )
      return PASSWORD_HINT;
  } else if (length < 1 || length > 128)
    return 'Enter your password (up to 128 characters).';
}

export function nameError(value: string): string | undefined {
  const length = Array.from(value.trim()).length;
  if (length < 2 || length > 80)
    return 'Enter your full name (2–80 characters).';
}

export function confirmationError(
  password: string,
  confirmation: string,
): string | undefined {
  if (password !== confirmation || !confirmation)
    return 'Passwords must match.';
}

export function isProof(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function maskEmail(value: string): string {
  if (emailError(value)) return 'your email address';
  const [local, domain] = value.trim().split('@');
  return `${Array.from(local!)[0]}•••@${domain}`;
}
