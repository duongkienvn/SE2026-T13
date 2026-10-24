import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Alert } from '../../../components/Alert';
import type { RedirectState } from '../../../app/redirect';
import { isApiError } from '../../../lib/api-client';
import { googleSignIn } from '../api';
import { useAuth } from '../useAuth';
import { useAuthSession } from '../auth-session-context';
import { GoogleSignInButton } from './GoogleSignInButton';

export function GoogleAuth({ disabled = false }: { disabled?: boolean }) {
  const { signIn } = useAuth();
  const scope = useAuthSession();
  const from = (useLocation().state as RedirectState | null)?.from;
  const [error, setError] = useState<string>();
  const [verification, setVerification] = useState(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return (
    <section
      aria-label="Alternative sign-in"
      className="mt-5 space-y-4 short:mt-4 short:space-y-3"
    >
      <div className="flex items-center gap-3 text-xs text-muted">
        <span aria-hidden="true" className="h-px flex-1 bg-line" />
        <span>or continue with</span>
        <span aria-hidden="true" className="h-px flex-1 bg-line" />
      </div>
      <GoogleSignInButton
        fitContainer
        disabled={disabled}
        onStart={() => {
          setError(undefined);
          setVerification(false);
          return async (credential) => {
            if (!alive.current || !scope.isCurrent()) return;
            try {
              const result = await googleSignIn(credential);
              if (alive.current && scope.isCurrent()) signIn(result);
            } catch (error) {
              if (!alive.current || !scope.isCurrent()) return;
              if (isApiError(error) && error.code === 'ACCOUNT_LINK_REQUIRED') {
                setError(
                  'This email already has a Kanvexa account. Log in with your password, then open Profile → Connected accounts to connect Google.',
                );
              } else if (
                isApiError(error) &&
                ['EMAIL_NOT_VERIFIED', 'MAIL_DELIVERY_UNAVAILABLE'].includes(
                  error.code,
                )
              ) {
                setError(
                  'Verify your email with Kanvexa, then return here and continue with Google. If no email arrives, request another verification email.',
                );
                setVerification(true);
              } else if (isApiError(error) && error.status === 429) {
                setError('Too many attempts. Please wait before trying again.');
              } else {
                setError(
                  'Google sign-in is unavailable or could not be verified. Try again or use email and password.',
                );
              }
            }
          };
        }}
      />
      {error && (
        <div>
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      {verification && (
        <Link
          className="mt-2 block font-semibold text-primary underline"
          to="/check-email"
          state={{ from } satisfies RedirectState}
        >
          Request verification email
        </Link>
      )}
    </section>
  );
}
