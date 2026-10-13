/*
 * Access-token storage for the MVP: sessionStorage (cleared with the tab).
 * This is not XSS protection; the backend remains the only authority on validity.
 */

const STORAGE_KEY = 'kanban.session';

export interface StoredSession {
  accessToken: string;
  /** Epoch milliseconds after which the token is treated as expired on the client. */
  expiresAt: number;
}

export function saveSession(
  accessToken: string,
  expiresInSeconds: number,
  now = Date.now(),
): StoredSession {
  const session = { accessToken, expiresAt: now + expiresInSeconds * 1000 };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage may be unavailable (private mode, quota); keep the in-memory session.
  }
  return session;
}

/** Returns the stored session, or `null` if missing, malformed or expired. */
export function readSession(now = Date.now()): StoredSession | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof parsed.accessToken === 'string' &&
      parsed.accessToken &&
      typeof parsed.expiresAt === 'number' &&
      parsed.expiresAt > now
    ) {
      return { accessToken: parsed.accessToken, expiresAt: parsed.expiresAt };
    }
  } catch {
    // Fall through and clear the malformed entry.
  }
  clearSession();
  return null;
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
