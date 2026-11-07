import { Link, Navigate, useLocation } from 'react-router';
import { Alert } from '../../../components/Alert';
import { buttonClassName } from '../../../components/Button';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { AuthEntryLayout } from '../components/AuthEntryLayout';

/** Signed-out confirmation shown once after a committed deletion (#225). */
export function AccountDeletedPage() {
  usePageTitle('Account deleted');
  const state = useLocation().state as { accountDeleted?: boolean } | null;
  if (!state?.accountDeleted) return <Navigate to="/" replace />;
  return (
    <AuthEntryLayout kind="recovery">
      <h1>Your account has been deleted</h1>
      <p className="auth-entry-intro">
        You have been signed out on this device.
      </p>
      <div className="mt-6 space-y-4">
        <Alert variant="success">
          Your sign-in identity and private account data were removed. Shared
          boards and comments now show “Deleted user”.
        </Alert>
        <Link to="/" className={buttonClassName('primary', 'lg')}>
          Go to the Kanvexa home page
        </Link>
        <Link
          to="/register"
          className="block text-sm font-semibold text-primary underline"
        >
          Create a new account
        </Link>
      </div>
    </AuthEntryLayout>
  );
}
