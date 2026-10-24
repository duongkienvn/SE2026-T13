import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { PasswordField } from '../../../components/PasswordField';
import { isApiError } from '../../../lib/api-client';
import { getLinkedProviders, linkGoogle } from '../api';
import { useAuth } from '../useAuth';
import { useAuthSession } from '../auth-session-context';
import { GoogleSignInButton } from './GoogleSignInButton';

export function ConnectedAccounts() {
  const { runAuthorized } = useAuth();
  const scope = useAuthSession();
  const queryClient = useQueryClient();
  const key = ['auth', 'linked-providers', scope.generation] as const;
  const status = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      runAuthorized((token) => getLinkedProviders(token, signal)),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [connected, setConnected] = useState(false);
  const alive = useRef(false);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  return (
    <section
      ref={section}
      aria-labelledby="connected-accounts-heading"
      className="mt-6 max-w-4xl rounded-xl border border-line bg-surface p-5 shadow-card md:p-6"
    >
      <h2
        id="connected-accounts-heading"
        className="text-lg font-semibold text-ink"
      >
        Connected accounts
      </h2>
      <p className="mt-1 text-sm text-muted">
        Connect Google to sign in to the same Kanvexa account.
      </p>
      {status.isPending && (
        <p className="mt-3 text-sm text-muted">Loading connected accounts…</p>
      )}
      {status.isError && (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-muted">
            Could not load connected accounts.
          </p>
          <Button
            type="button"
            onClick={() => {
              void status.refetch();
            }}
          >
            Retry connected accounts
          </Button>
        </div>
      )}
      {status.data && (
        <div className="mt-4 max-w-md space-y-4">
          <p className="text-sm text-ink">
            Google:{' '}
            <strong>
              {status.data.googleLinked ? 'Connected' : 'Not connected'}
            </strong>
          </p>
          {!status.data.hasPassword && (
            <p className="text-sm text-muted">
              You sign in with Google. A password has not been set for this
              account.
            </p>
          )}
          {connected && (
            <Alert variant="success">
              Google connected. You can now sign in with Google or your existing
              password.
            </Alert>
          )}
          {error && <Alert variant="error">{error}</Alert>}
          {status.data.hasPassword && !status.data.googleLinked && (
            <>
              <p className="text-sm text-muted">
                Confirm your current Kanvexa password, then choose a Google
                account with the same verified email.
              </p>
              <PasswordField
                label="Current password"
                name="googleLinkPassword"
                autoComplete="current-password"
                maxLength={128}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={pending}
              />
              <GoogleSignInButton
                disabled={pending}
                onStart={() => {
                  setError(undefined);
                  if (!password) {
                    setError(
                      'Enter your current Kanvexa password before connecting Google.',
                    );
                    section.current
                      ?.querySelector<HTMLInputElement>(
                        'input[name="googleLinkPassword"]',
                      )
                      ?.focus();
                    return;
                  }
                  const confirmedPassword = password;
                  return async (credential) => {
                    if (!alive.current || !scope.isCurrent()) return;
                    setPending(true);
                    setPassword('');
                    try {
                      await runAuthorized((token) =>
                        linkGoogle(token, credential, confirmedPassword),
                      );
                      if (!alive.current || !scope.isCurrent()) return;
                      queryClient.setQueryData(key, {
                        googleLinked: true,
                        hasPassword: true,
                      });
                      setConnected(true);
                    } catch (error) {
                      if (!alive.current || !scope.isCurrent()) return;
                      setError(
                        isApiError(error) &&
                          error.code === 'INVALID_CREDENTIALS'
                          ? 'Could not confirm your current password. Please enter it again.'
                          : isApiError(error) &&
                              error.code === 'GOOGLE_ACCOUNT_CONFLICT'
                            ? 'Choose a Google account with the same verified email that is not connected to another Kanvexa account.'
                            : isApiError(error) && error.status === 429
                              ? 'Too many attempts. Please wait before trying again.'
                              : 'Google could not be connected. Please try again later.',
                      );
                    } finally {
                      if (alive.current && scope.isCurrent()) setPending(false);
                    }
                  };
                }}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}
