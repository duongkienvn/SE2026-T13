import { useLayoutEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Alert } from '../../../components/Alert';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { resetPassword } from '../api';
import { AuthLayout } from '../components/AuthLayout';
import { NewPasswordForm } from '../components/NewPasswordForm';
import {
  clearIncomingRecoveryToken,
  readIncomingRecoveryToken,
} from '../recovery-link';
import { useAuth } from '../useAuth';

export function ResetPasswordPage() {
  usePageTitle('Reset password');
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, status } = useAuth();
  const token = useRef(
    readIncomingRecoveryToken() ??
      new URLSearchParams(location.search).get('token'),
  );
  useLayoutEffect(() => {
    clearIncomingRecoveryToken();
    if (location.search || location.hash)
      navigate('/reset-password', { replace: true });
  }, [location.search, location.hash, navigate]);
  const valid = token.current && /^[A-Za-z0-9_-]{43}$/.test(token.current);
  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold text-ink">Reset your password</h1>
      <p className="mt-2 text-sm text-muted">
        Choose a strong password for your Kanvexa account.
      </p>
      {valid ? (
        <NewPasswordForm
          submit={(password) => resetPassword(token.current!, password)}
          onSuccess={() => {
            token.current = null;
            if (status !== 'anonymous') signOut();
            navigate('/login', {
              replace: true,
              state: { passwordUpdated: true },
            });
          }}
        />
      ) : (
        <div className="mt-6">
          <Alert variant="error">
            This recovery link is invalid or expired. Request a new link.
          </Alert>
        </div>
      )}
      <Link
        to="/forgot-password"
        className="mt-5 block font-semibold text-primary underline"
      >
        Request a new recovery link
      </Link>
      <Link to="/login" className="mt-4 block text-sm text-primary underline">
        Back to login
      </Link>
    </AuthLayout>
  );
}
