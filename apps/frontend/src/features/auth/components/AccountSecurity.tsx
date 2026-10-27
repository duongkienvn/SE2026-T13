import { useQuery } from '@tanstack/react-query';
import { flushSync } from 'react-dom';
import { useNavigate, Link } from 'react-router';
import { Button } from '../../../components/Button';
import { changePassword, getLinkedProviders } from '../api';
import { useAuthSession } from '../auth-session-context';
import { useAuth } from '../useAuth';
import { NewPasswordForm } from './NewPasswordForm';

/** Mount inside an authenticated page; reusable by #92 /settings/security. */
export function AccountSecurity() {
  const { runAuthorized, signOut } = useAuth();
  const scope = useAuthSession();
  const navigate = useNavigate();
  const providers = useQuery({
    queryKey: ['auth', 'linked-providers', scope.generation],
    queryFn: ({ signal }) =>
      runAuthorized((token) => getLinkedProviders(token, signal)),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const hasPassword = providers.data?.hasPassword === true;
  return (
    <section
      aria-labelledby="account-security-heading"
      className="mt-6 max-w-2xl rounded-xl border border-line bg-surface p-5 shadow-card md:p-6"
    >
      <div className="min-w-0">
        <h2
          id="account-security-heading"
          className="text-lg font-semibold text-ink"
        >
          Account security
        </h2>
        {providers.isPending && (
          <p role="status" className="mt-3 text-sm text-muted">
            Loading password settings…
          </p>
        )}
        {providers.isError && (
          <div className="mt-3 space-y-3">
            <p role="alert">Could not load password settings.</p>
            <Button
              type="button"
              onClick={() => {
                void providers.refetch();
              }}
            >
              Retry password settings
            </Button>
          </div>
        )}
        {hasPassword && (
          <p className="mt-2 max-w-md text-sm text-muted">
            Confirm your current password to choose a new one. You will need to
            log in again after saving.
          </p>
        )}
        {providers.data && !providers.data.hasPassword && (
          <p className="mt-3 max-w-lg text-sm text-muted">
            You sign in with Google and have no local password. To set a
            password, request a recovery link and confirm it from your verified
            email. Your Google connection stays available.
          </p>
        )}
      </div>
      {hasPassword && (
        <NewPasswordForm
          key={scope.generation}
          requireCurrent
          submit={(next, current) =>
            runAuthorized((token) => changePassword(token, current, next))
          }
          onSuccess={() => {
            if (!scope.isCurrent()) return;
            // Settle RequireAuth's logout redirect before replacing it with
            // one-time confirmation; otherwise its effect can overwrite state.
            flushSync(() => signOut({ notifyServer: false }));
            navigate('/login', {
              replace: true,
              state: { passwordUpdated: true },
            });
          }}
        />
      )}
      {providers.data && (
        <Link
          className="mt-5 inline-block text-sm font-semibold text-primary underline focus-visible:outline-2 focus-visible:outline-primary"
          to="/forgot-password"
        >
          {providers.data.hasPassword
            ? 'Recover a forgotten password'
            : 'Set password via email'}
        </Link>
      )}
    </section>
  );
}
