import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router';
import { Alert } from '../../../components/Alert';
import { Button, buttonClassName } from '../../../components/Button';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { ClientErrorCode, isApiError } from '../../../lib/api-client';
import { confirmEmailChange } from '../api';
import { useAuthSession } from '../auth-session-context';
import { AuthEntryLayout } from '../components/AuthEntryLayout';
import {
  clearIncomingEmailChangeToken,
  EMAIL_CHANGE_PATH,
  isEmailChangeToken,
  readIncomingEmailChangeToken,
} from '../email-change-link';
import { useAuth } from '../useAuth';

const INVALID_LINK =
  'This link is invalid, expired or already used, or it belongs to a different account. Make sure you are signed in to the account that asked for the change, or request a new link from Settings → Security.';

function confirmErrorMessage(error: unknown): {
  message: string;
  retry: boolean;
} {
  if (!isApiError(error))
    return {
      message: 'Your email could not be changed. Please try again.',
      retry: true,
    };
  if (error.code === ClientErrorCode.NETWORK_ERROR)
    return {
      message:
        'Could not reach the server. Check your connection and try again.',
      retry: true,
    };
  if (error.status === 400) return { message: INVALID_LINK, retry: false };
  if (error.status === 409)
    return {
      message:
        'This email address can no longer be used, so your email was not changed. Request a change to a different address.',
      retry: false,
    };
  if (error.status === 429)
    return {
      message: 'Too many attempts. Wait a few minutes and try again.',
      retry: true,
    };
  return {
    message:
      'Your email could not be changed right now. Please try again later.',
    retry: true,
  };
}

/**
 * Mail-link handoff for a verified email change (#217). Opening the link
 * never changes anything: a signed-in user of the same account must press
 * Confirm. The proof lives only in this page's memory.
 */
export function ConfirmEmailChangePage() {
  usePageTitle('Confirm email change');
  const location = useLocation();
  const navigate = useNavigate();
  const { status, user, runAuthorized, signOut, retry } = useAuth();
  const scope = useAuthSession();
  const token = useRef<string | null>(
    readIncomingEmailChangeToken() ??
      new URLSearchParams(location.search).get('token'),
  );
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [usable, setUsable] = useState(() => isEmailChangeToken(token.current));
  const busy = useRef(false);

  // In-app navigation with ?token= (no full load) is cleaned up here too.
  useLayoutEffect(() => {
    clearIncomingEmailChangeToken();
    if (location.search || location.hash)
      navigate(EMAIL_CHANGE_PATH, { replace: true });
  }, [location.search, location.hash, navigate]);

  const confirm = async () => {
    const proof = token.current;
    if (busy.current || !isEmailChangeToken(proof) || !scope.isCurrent())
      return;
    busy.current = true;
    setConfirming(true);
    setError(undefined);
    try {
      await runAuthorized((accessToken) =>
        confirmEmailChange(accessToken, proof),
      );
      token.current = null;
      // A late success must not sign out a newer session.
      if (!scope.isCurrent()) return;
      flushSync(() => signOut({ notifyServer: false }));
      navigate('/login', { replace: true, state: { emailChanged: true } });
    } catch (failure) {
      if (!scope.isCurrent()) return;
      const result = confirmErrorMessage(failure);
      if (!result.retry) {
        token.current = null;
        setUsable(false);
      }
      setError(result.message);
    } finally {
      busy.current = false;
      setConfirming(false);
    }
  };

  return (
    <AuthEntryLayout kind="recovery">
      <h1>Confirm your new email</h1>
      {!usable ? (
        <>
          <div className="mt-6">
            <Alert variant="error">{error ?? INVALID_LINK}</Alert>
          </div>
          <Link
            to={status === 'authenticated' ? '/settings/security' : '/login'}
            className="mt-5 block font-semibold text-primary underline"
          >
            {status === 'authenticated'
              ? 'Go to Security settings'
              : 'Back to login'}
          </Link>
        </>
      ) : status === 'loading' ? (
        <p role="status" className="auth-entry-intro">
          Checking your session…
        </p>
      ) : status === 'error' ? (
        <div className="mt-6 space-y-4">
          <Alert variant="error">
            We couldn’t check your session. Check your connection and try again.
          </Alert>
          <Button size="lg" onClick={retry}>
            Try again
          </Button>
        </div>
      ) : status === 'anonymous' ? (
        <>
          <p className="auth-entry-intro">
            To protect your account, an email change is confirmed only while you
            are signed in.
          </p>
          <div className="mt-6 space-y-4 text-sm text-muted">
            <p>
              Sign in with your <strong className="text-ink">current</strong>{' '}
              email address (not the new one), then open the link from the email
              again.
            </p>
            <Link to="/login" className={buttonClassName('primary', 'lg')}>
              Sign in
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="auth-entry-intro">
            You’re signed in as{' '}
            <strong className="text-ink">{user?.email}</strong>. Confirm to
            change this account’s email to the address that received this link.
          </p>
          <div className="mt-6 space-y-4">
            {error && <Alert variant="error">{error}</Alert>}
            <Button
              size="lg"
              className="w-full"
              disabled={confirming}
              aria-busy={confirming || undefined}
              onClick={() => void confirm()}
            >
              {confirming ? 'Confirming…' : 'Confirm email change'}
            </Button>
            <p className="text-sm text-muted">
              Afterwards you’ll be signed out and sign in again with your new
              email. Not your account?{' '}
              <button
                type="button"
                className="font-semibold text-primary underline focus-visible:outline-2 focus-visible:outline-primary"
                disabled={confirming}
                onClick={() => signOut()}
              >
                Sign out
              </button>{' '}
              and sign in to the account that asked for the change.
            </p>
          </div>
        </>
      )}
    </AuthEntryLayout>
  );
}
