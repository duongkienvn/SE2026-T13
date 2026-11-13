/**
 * Public Google OAuth client identifiers. They are not secrets, but they are
 * still validated so a typo hides the Google action instead of showing a button
 * that can never finish.
 */
const CLIENT_ID = /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;

export interface GoogleClientConfig {
  /** Backend `GOOGLE_CLIENT_ID`. Every ID token must carry this audience. */
  readonly webClientId: string;
  /** iOS native OAuth client. Android uses package + signing fingerprint instead. */
  readonly iosClientId?: string;
}

export interface GoogleEnvironment {
  readonly webClientId?: string;
  readonly iosClientId?: string;
}

function clientId(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && CLIENT_ID.test(trimmed) ? trimmed : null;
}

/** `null` means: no Google action on this platform. */
export function parseGoogleConfig(
  env: GoogleEnvironment,
  platform: string,
): GoogleClientConfig | null {
  const webClientId = clientId(env.webClientId);
  if (!webClientId) return null;
  if (platform === 'android') return { webClientId };
  if (platform !== 'ios') return null;
  const iosClientId = clientId(env.iosClientId);
  // iOS cannot mint tokens without its own registered client.
  return iosClientId && iosClientId !== webClientId
    ? { webClientId, iosClientId }
    : null;
}
