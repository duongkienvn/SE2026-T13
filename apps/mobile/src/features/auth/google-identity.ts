import type {
  EstablishResult,
  LoginResponseLike,
} from '../../infrastructure/auth/session-manager.ts';

/** Matches the backend `GoogleAuthDto.credential` limit. */
export const MAX_GOOGLE_CREDENTIAL_LENGTH = 8192;
const GOOGLE_ISSUERS = new Set([
  'accounts.google.com',
  'https://accounts.google.com',
]);

/** What the native Google SDK produced. The token never leaves this module family. */
export type GoogleProviderResult =
  | { readonly kind: 'token'; readonly idToken: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'play-services' }
  | { readonly kind: 'failed' };

/** Port over the native SDK, so the flow is testable without a device. */
export interface GoogleIdentityProvider {
  /** Backend Web/server client ID the token must be minted for. */
  readonly webClientId: string;
  requestIdToken(): Promise<GoogleProviderResult>;
  /** Forget the Google account chosen in the SDK. Never throws. */
  reset(): Promise<void>;
}

export type GoogleSignInOutcome =
  | { readonly kind: 'signed-in' }
  | { readonly kind: 'cancelled' }
  /** Cancelled, signed out, replaced or retried meanwhile: nothing was applied. */
  | { readonly kind: 'stale' }
  | {
      readonly kind: 'provider';
      readonly reason: 'busy' | 'play-services' | 'failed' | 'audience';
    }
  | {
      readonly kind: 'session';
      readonly reason: 'invalid-response' | 'rejected' | 'unavailable';
    };

function decodeSegment(segment: string): unknown {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  // Byte string, not UTF-8 decoded: only the ASCII `aud`/`iss` claims are read.
  return JSON.parse(atob(padded));
}

/**
 * Cheap pre-flight check of the unverified claims. It only stops tokens that
 * were obviously minted for another client (for example a native Android/iOS
 * audience); the backend still verifies signature, audience and expiry.
 */
export function hasIntendedAudience(
  idToken: string,
  webClientId: string,
): boolean {
  if (
    idToken.length > MAX_GOOGLE_CREDENTIAL_LENGTH ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(idToken)
  )
    return false;
  try {
    const claims = decodeSegment(idToken.split('.')[1]!) as Record<
      string,
      unknown
    > | null;
    return (
      !!claims &&
      claims.aud === webClientId &&
      typeof claims.iss === 'string' &&
      GOOGLE_ISSUERS.has(claims.iss)
    );
  } catch {
    return false;
  }
}

export interface GoogleSignInDeps {
  readonly provider: GoogleIdentityProvider;
  readonly exchange: (
    credential: string,
    signal: AbortSignal,
  ) => Promise<LoginResponseLike>;
  readonly establish: (
    response: LoginResponseLike,
    signal: AbortSignal,
  ) => Promise<EstablishResult>;
}

/**
 * One attempt: native consent → `POST /auth/google` → MOB-05 session.
 * `current()` is bound to the attempt's abort signal and session generation;
 * any late step after cancel, sign-out or account replacement is discarded.
 * Backend HTTP failures are thrown as `ApiError` for the screen to explain.
 */
export async function signInWithGoogle(
  deps: GoogleSignInDeps,
  signal: AbortSignal,
  current: () => boolean,
): Promise<GoogleSignInOutcome> {
  if (!current()) return { kind: 'stale' };
  let result: GoogleProviderResult;
  try {
    result = await deps.provider.requestIdToken();
  } finally {
    // The Kanvexa JWT is the only session. Do not keep a Google SDK sign-in
    // around, so the next attempt (or another user) chooses an account again.
    void deps.provider.reset();
  }
  if (!current()) return { kind: 'stale' };
  if (result.kind === 'cancelled') return { kind: 'cancelled' };
  if (result.kind !== 'token') return { kind: 'provider', reason: result.kind };
  if (!hasIntendedAudience(result.idToken, deps.provider.webClientId))
    return { kind: 'provider', reason: 'audience' };

  const response = await deps.exchange(result.idToken, signal);
  if (!current()) return { kind: 'stale' };
  const established = await deps.establish(response, signal);
  if (established.ok) return { kind: 'signed-in' };
  if (established.reason === 'superseded') return { kind: 'stale' };
  return { kind: 'session', reason: established.reason };
}
