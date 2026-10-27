/*
 * Same-origin access-token persistence. LocalStorage survives closing a tab;
 * the fixed expiry and server validation still govern validity.
 * This is not XSS protection; the backend remains the only authority on validity.
 */

export const SESSION_STORAGE_KEY = 'kanban.session';

function clearLegacySession() {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Legacy storage may also be blocked; never read or import it.
  }
}

/** Raw snapshot for detecting changes before a queued storage event is handled.
 * `undefined` means storage is unavailable, allowing the in-memory fallback.
 */
export function readStoredSessionValue(): string | null | undefined {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return undefined;
  }
}

export interface StoredSession {
  accessToken: string;
  /** Epoch milliseconds after which the token is treated as expired on the client. */
  expiresAt: number;
}

export interface SessionSnapshot {
  session: StoredSession | null;
  /** The exact storage value that produced this session, not a later read. */
  storedValue: string | null | undefined;
}

export function saveSession(
  accessToken: string,
  expiresInSeconds: number,
  now = Date.now(),
): SessionSnapshot {
  const session = { accessToken, expiresAt: now + expiresInSeconds * 1000 };
  const storedValue = JSON.stringify(session);
  clearLegacySession();
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, storedValue);
    return { session, storedValue };
  } catch {
    // Storage may be unavailable (private mode, quota); keep the in-memory session.
    // Do not leave credentials from a previous account behind if removal works.
    return { ...clearSession(), session };
  }
}

/** Returns the stored session, or `null` if missing, malformed or expired. */
export function readSession(now = Date.now()): StoredSession | null {
  return readSessionSnapshot(now).session;
}

export function readSessionSnapshot(now = Date.now()): SessionSnapshot {
  clearLegacySession();
  const raw = readStoredSessionValue();
  if (!raw) return { session: null, storedValue: raw };

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof parsed.accessToken === 'string' &&
      parsed.accessToken &&
      typeof parsed.expiresAt === 'number' &&
      Number.isFinite(parsed.expiresAt) &&
      parsed.expiresAt > now
    ) {
      return {
        session: {
          accessToken: parsed.accessToken,
          expiresAt: parsed.expiresAt,
        },
        storedValue: raw,
      };
    }
  } catch {
    // Fall through and clear the malformed entry.
  }
  if (readStoredSessionValue() === raw) return clearSession();
  // Another tab replaced the bad value. Leave that value for synchronization.
  return { session: null, storedValue: raw };
}

export function clearSession(): SessionSnapshot {
  clearLegacySession();
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    return { session: null, storedValue: null };
  } catch {
    return { session: null, storedValue: readStoredSessionValue() };
  }
}
