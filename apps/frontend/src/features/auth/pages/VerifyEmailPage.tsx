import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Alert } from '../../../components/Alert';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { isApiError } from '../../../lib/api-client';
import { verifyEmail } from '../api';
import { AuthLayout } from '../components/AuthLayout';
import {
  clearIncomingVerificationToken,
  readIncomingVerificationToken,
} from '../verification-link';

export function VerifyEmailPage() {
  usePageTitle('Verify email');
  const location = useLocation();
  const navigate = useNavigate();
  const token = useRef(
    readIncomingVerificationToken() ??
      new URLSearchParams(location.search).get('token'),
  );
  const request = useRef<Promise<void> | null>(null);
  const [status, setStatus] = useState<
    'verifying' | 'success' | 'invalid' | 'error'
  >(() =>
    token.current && /^[A-Za-z0-9_-]{43}$/.test(token.current)
      ? 'verifying'
      : 'invalid',
  );

  useLayoutEffect(() => {
    clearIncomingVerificationToken();
    if (location.search || location.hash)
      navigate('/verify-email', { replace: true });
  }, [location.search, location.hash, navigate]);

  useEffect(() => {
    let active = true;
    if (!request.current) {
      const value = token.current;
      token.current = null;
      if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return;
      // Reuse this promise when StrictMode replays the effect; never auto-retry a
      // single-use token after an ambiguous response or network failure.
      request.current = verifyEmail(value);
    }
    void request.current.then(
      () => {
        if (active) setStatus('success');
      },
      (error: unknown) => {
        if (active)
          setStatus(
            isApiError(error) && error.code === 'INVALID_VERIFICATION_TOKEN'
              ? 'invalid'
              : 'error',
          );
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold text-ink">Verify your email</h1>
      <div className="mt-6 space-y-4">
        {status === 'verifying' && (
          <p role="status">Verifying your email address…</p>
        )}
        {status === 'success' && (
          <Alert variant="success">
            Email verified. You can now log in to Kanvexa.
          </Alert>
        )}
        {status === 'invalid' && (
          <Alert variant="error">
            This verification link is invalid or expired. Request a new link.
          </Alert>
        )}
        {status === 'error' && (
          <Alert variant="error">
            We could not confirm verification. If the request completed, you can
            log in; otherwise request a new link.
          </Alert>
        )}
        <Link
          className="block font-semibold text-primary underline"
          to="/login"
        >
          Back to login
        </Link>
        {status !== 'success' && (
          <Link
            className="block font-semibold text-primary underline"
            to="/check-email"
          >
            Request a new verification email
          </Link>
        )}
      </div>
    </AuthLayout>
  );
}
