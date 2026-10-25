export const DEFAULT_AUTHENTICATED_PATH = '/boards';

const PUBLIC_ONLY_PATHS = [
  '/login',
  '/register',
  '/check-email',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
];

/**
 * Returns `value` only if it is a same-origin, in-app path that is worth
 * returning to after login; otherwise the default landing page.
 */
export function safeRedirectPath(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_AUTHENTICATED_PATH;
  // Reject protocol-relative ("//evil.com") and backslash tricks ("/\evil.com").
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return DEFAULT_AUTHENTICATED_PATH;
  const pathname = value.split(/[?#]/)[0];
  if (PUBLIC_ONLY_PATHS.includes(pathname)) return DEFAULT_AUTHENTICATED_PATH;
  return value;
}

/** Router `state` carried to the login page. */
export interface RedirectState {
  passwordUpdated?: boolean;
  /** Protected path the user tried to open before signing in. */
  from?: string;
  /** Set after a successful registration to show feedback and prefill the email. */
  registeredEmail?: string;
  verificationRequested?: boolean;
  mailUnavailable?: boolean;
}
