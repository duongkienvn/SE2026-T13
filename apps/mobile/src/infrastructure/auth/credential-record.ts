/**
 * The only session data Kanvexa Mobile persists: one bearer JWT, its absolute
 * local expiry and a schema version. No profile, cache or refresh token.
 */
export const CREDENTIAL_RECORD_VERSION = 1;

/** Backend tokens are ~250 characters; anything far larger is not ours. */
const MAX_TOKEN_LENGTH = 4096;
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * The backend issues one-hour tokens (`JWT_EXPIRES_IN_SECONDS = 3600`). A
 * lifetime above one day means the response is not the contract we verified.
 */
export const MAX_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;

export interface StoredCredential {
  readonly accessToken: string;
  /** Absolute expiry in Unix milliseconds on this device's clock. */
  readonly expiresAt: number;
  /** JWT `sub`: the user the backend issued the token for. */
  readonly subject: string;
}

interface CredentialRecordV1 {
  v: typeof CREDENTIAL_RECORD_VERSION;
  accessToken: string;
  expiresAt: number;
}

function decodeBase64Url(segment: string): string | null {
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    // Byte string is enough: the claims read here (`sub`, `exp`) are ASCII,
    // and Hermes does not guarantee `TextDecoder`.
    return atob(padded);
  } catch {
    return null;
  }
}

/**
 * Reads the JWT subject without trusting it: the signature is checked only by
 * the server. The subject lets the client reject a token whose `/users/me`
 * identity differs from the one it was issued for.
 */
export function readTokenSubject(accessToken: string): string | null {
  if (accessToken.length > MAX_TOKEN_LENGTH || !JWT_PATTERN.test(accessToken))
    return null;
  const json = decodeBase64Url(accessToken.split('.')[1]!);
  if (json === null) return null;
  try {
    const claims: unknown = JSON.parse(json);
    if (typeof claims !== 'object' || claims === null) return null;
    const { sub, exp } = claims as { sub?: unknown; exp?: unknown };
    if (typeof sub !== 'string' || !UUID_PATTERN.test(sub)) return null;
    if (typeof exp !== 'number' || !Number.isSafeInteger(exp)) return null;
    return sub.toLowerCase();
  } catch {
    return null;
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Builds a credential from a fresh login response. Expiry comes from the
 * response's `expiresIn` on the device clock, not from the JWT `exp`, so a
 * device whose clock disagrees with the server does not reject every login.
 */
export function credentialFromLogin(
  accessToken: unknown,
  expiresIn: unknown,
  receivedAt: number,
): StoredCredential | null {
  if (typeof accessToken !== 'string') return null;
  if (
    typeof expiresIn !== 'number' ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > MAX_TOKEN_LIFETIME_SECONDS
  )
    return null;
  const subject = readTokenSubject(accessToken);
  if (subject === null) return null;
  const expiresAt = receivedAt + expiresIn * 1000;
  if (!Number.isSafeInteger(expiresAt)) return null;
  return { accessToken, expiresAt, subject };
}

export function encodeCredential(credential: StoredCredential): string {
  const record: CredentialRecordV1 = {
    v: CREDENTIAL_RECORD_VERSION,
    accessToken: credential.accessToken,
    expiresAt: credential.expiresAt,
  };
  return JSON.stringify(record);
}

/** Returns `null` for anything that is not an intact version-1 record. */
export function decodeCredential(raw: string): StoredCredential | null {
  if (raw.length > MAX_TOKEN_LENGTH + 128) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return null;
  const record = parsed as Partial<Record<keyof CredentialRecordV1, unknown>>;
  if (
    record.v !== CREDENTIAL_RECORD_VERSION ||
    Object.keys(record).length !== 3 ||
    typeof record.accessToken !== 'string' ||
    typeof record.expiresAt !== 'number' ||
    !Number.isSafeInteger(record.expiresAt) ||
    record.expiresAt <= 0
  )
    return null;
  const subject = readTokenSubject(record.accessToken);
  if (subject === null) return null;
  return {
    accessToken: record.accessToken,
    expiresAt: record.expiresAt,
    subject,
  };
}
