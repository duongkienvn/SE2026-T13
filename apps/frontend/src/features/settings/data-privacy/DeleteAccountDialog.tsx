import type { AccountDeletionBlocker } from '@kanban/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate } from 'react-router';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import {
  AlertIcon,
  CloseIcon,
  InfoIcon,
  TrashIcon,
} from '../../../components/icons';
import { PasswordField } from '../../../components/PasswordField';
import { TextField } from '../../../components/TextField';
import {
  ACCOUNT_DELETION_BLOCKED,
  ClientErrorCode,
  isApiError,
} from '../../../lib/api-client';
import {
  deleteAccount,
  getLinkedProviders,
  GoogleProofRejectedError,
} from '../../auth/api';
import { useAuthSession } from '../../auth/auth-session-context';
import { GoogleSignInButton } from '../../auth/components/GoogleSignInButton';
import {
  availableProofMethods,
  ProofMethodChoice,
  type ProofMethod,
} from '../../auth/components/ProofMethodChoice';
import { useAuth } from '../../auth/useAuth';

const CONFIRMATION = 'DELETE';

const BLOCKER_COPY: Record<
  AccountDeletionBlocker['type'],
  { title: string; help: string; action: string; href: (id: string) => string }
> = {
  PERSONAL_WORKSPACE_HAS_BOARDS: {
    title: 'Move boards out of your Personal workspace',
    help: 'Every board in your Personal workspace, active or archived, must first be moved to a Team workspace.',
    action: 'Move',
    href: (id) => `/boards/${encodeURIComponent(id)}/settings`,
  },
  BOARD_REQUIRES_ANOTHER_OWNER: {
    title: 'Add another owner to these boards',
    help: 'Promote another member to owner on each board, including archived boards.',
    action: 'Members',
    href: (id) => `/boards/${encodeURIComponent(id)}/members`,
  },
  TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN: {
    title: 'Add another admin to these Team workspaces',
    help: 'Make another member an admin of each Team workspace you administer.',
    action: 'Members',
    href: (id) => `/workspaces/${encodeURIComponent(id)}/members`,
  },
};

function deletionErrorMessage(
  error: unknown,
  method: ProofMethod,
  hasPassword: boolean,
): { form?: string; password?: string } {
  if (error instanceof GoogleProofRejectedError)
    return {
      form: 'Google couldn’t confirm your identity. Verify again with your linked Google account.',
    };
  if (!isApiError(error))
    return { form: 'Your account could not be deleted. Please try again.' };
  if (error.code === ClientErrorCode.NETWORK_ERROR)
    return {
      form: 'Could not reach the server. Your account was not deleted. Check your connection and try again.',
    };
  if (error.status === 403)
    return method === 'password'
      ? { password: 'Your current password is incorrect.' }
      : {
          form: 'This Google account isn’t the one linked to your Kanvexa account.',
        };
  if (error.status === 400)
    return { form: `Type ${CONFIRMATION} exactly as shown and try again.` };
  if (error.status === 409)
    return {
      form: 'Another change to your account is in progress. Your account was not deleted; try again in a moment.',
    };
  if (error.status === 429)
    return { form: 'Too many attempts. Wait a few minutes and try again.' };
  if (error.status === 503)
    return {
      form: hasPassword
        ? 'Google verification is unavailable right now. Use your password or try again later.'
        : 'Google verification is unavailable right now. Please try again later.',
    };
  return {
    form: 'Your account could not be deleted right now. Please try again later.',
  };
}

/** Server blockers from a real 409; never guessed from client data. */
function BlockerList({ blockers }: { blockers: AccountDeletionBlocker[] }) {
  return (
    <div
      role="alert"
      className="space-y-3 rounded-xl border border-danger/30 bg-danger/5 p-3.5 text-sm"
    >
      <p className="font-semibold text-ink">
        Your account can’t be deleted yet. Resolve these first, then try again:
      </p>
      {blockers.map((blocker) => {
        const copy = BLOCKER_COPY[blocker.type];
        return (
          <section key={blocker.type} aria-label={copy.title}>
            <h3 className="font-semibold text-ink">
              {copy.title}{' '}
              <span className="font-normal text-muted">
                ({blocker.totalCount})
              </span>
            </h3>
            <p className="text-muted">{copy.help}</p>
            {blocker.resources.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {blocker.resources.map((resource) => (
                  <li
                    key={resource.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="min-w-0 truncate text-ink">
                      {resource.name}
                    </span>
                    <Link
                      to={copy.href(resource.id)}
                      className="shrink-0 font-semibold text-primary underline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      {copy.action}
                      <span className="sr-only"> {resource.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {blocker.totalCount > blocker.resources.length && (
              <p className="mt-1 text-xs text-muted">
                Showing {blocker.resources.length} of {blocker.totalCount}.
              </p>
            )}
          </section>
        );
      })}
      <p className="text-xs text-muted">
        Restore an archived board first if a move or role change needs it.
      </p>
    </div>
  );
}

/**
 * Irreversible account deletion (#218): exact `DELETE`, one fresh proof and a
 * single request. Nothing happens on open, on typing or after a failure; only a
 * 204 signs the user out and leaves Settings.
 */
export function DeleteAccountDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { runAuthorized, signOut } = useAuth();
  const scope = useAuthSession();
  const navigate = useNavigate();
  const providers = useQuery({
    queryKey: ['auth', 'linked-providers', scope.generation],
    queryFn: ({ signal }) =>
      runAuthorized((token) => getLinkedProviders(token, signal)),
    retry: false,
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const [confirmation, setConfirmation] = useState('');
  const [chosen, setChosen] = useState<ProofMethod>('password');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string>();
  const [confirmationError, setConfirmationError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [blockers, setBlockers] = useState<AccountDeletionBlocker[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const methods = providers.data ? availableProofMethods(providers.data) : [];
  const method = methods.includes(chosen) ? chosen : (methods[0] ?? 'password');
  const hasPassword = providers.data?.hasPassword === true;
  const confirmed = confirmation === CONFIRMATION;

  const close = () => {
    if (busy.current) return;
    setConfirmation('');
    setPassword('');
    setPasswordError(undefined);
    setConfirmationError(undefined);
    setFormError(undefined);
    setBlockers([]);
    onClose();
  };

  const submit = async (
    proof: { currentPassword: string } | { googleCredential: string },
  ) => {
    if (busy.current || !scope.isCurrent()) return;
    busy.current = true;
    setSubmitting(true);
    setFormError(undefined);
    setPasswordError(undefined);
    setBlockers([]);
    try {
      await runAuthorized((token) =>
        deleteAccount(token, { confirmation: CONFIRMATION, ...proof }),
      );
      // Committed. A completion for an older session must not sign out a
      // newer one; that session's own guard handles the deleted identity.
      if (!scope.isCurrent()) return;
      flushSync(() => signOut({ notifyServer: false }));
      navigate('/account-deleted', {
        replace: true,
        state: { accountDeleted: true },
      });
    } catch (error) {
      if (!alive.current || !scope.isCurrent()) return;
      setPassword('');
      if (
        isApiError(error) &&
        error.code === ACCOUNT_DELETION_BLOCKED &&
        error.blockers.length > 0
      ) {
        setBlockers(error.blockers);
        return;
      }
      const result = deletionErrorMessage(error, method, hasPassword);
      setPasswordError(result.password);
      setFormError(result.form);
    } finally {
      busy.current = false;
      if (alive.current) setSubmitting(false);
    }
  };

  const checkConfirmation = () => {
    if (confirmed) return true;
    setConfirmationError(`Type ${CONFIRMATION} to confirm.`);
    return false;
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (method !== 'password' || submitting) return;
    if (!checkConfirmation()) return;
    if (!password) {
      setPasswordError('Enter your current password.');
      return;
    }
    void submit({ currentPassword: password });
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      dismissible={!submitting}
      title="Delete account"
      icon={
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger"
        >
          <TrashIcon className="size-5" />
        </span>
      }
      headerContent={
        <p className="-mt-1.5 text-sm text-muted">
          This action is irreversible.
        </p>
      }
      headerActions={
        <button
          type="button"
          aria-label="Close"
          disabled={submitting}
          onClick={close}
          className="grid size-9 place-items-center rounded-lg text-muted hover:bg-app hover:text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed"
        >
          <CloseIcon className="size-5" />
        </button>
      }
    >
      <form noValidate onSubmit={onSubmit} className="space-y-3.5 text-sm">
        <p className="text-muted">
          Your sign-in identity, profile, preferences and other private account
          data will be removed. Shared boards, cards, comments, activity and
          board files stay with your teams and will show{' '}
          <strong className="text-ink">“Deleted user”</strong>.
        </p>
        <div className="flex gap-3 rounded-xl border border-danger/30 bg-danger/5 p-3">
          <AlertIcon
            aria-hidden="true"
            className="size-5 shrink-0 text-danger"
          />
          <ul className="list-disc space-y-1 pl-4 text-ink">
            <li>This cannot be undone and there is no recovery period.</li>
            <li>
              Text you wrote in shared cards and comments is kept, not erased.
            </li>
            <li>
              Your email can be used for a new account later, but it won’t get
              back any board or workspace access.
            </li>
          </ul>
        </div>
        <p className="text-muted">
          Before deleting, move boards out of your Personal workspace and make
          sure every board you own has another owner and every Team workspace
          you administer has another admin. Archived boards count.
        </p>

        {blockers.length > 0 && <BlockerList blockers={blockers} />}
        {formError && <Alert variant="error">{formError}</Alert>}

        <TextField
          label={`Type ${CONFIRMATION} to confirm`}
          name="deleteConfirmation"
          autoComplete="off"
          spellCheck={false}
          placeholder={CONFIRMATION}
          value={confirmation}
          error={confirmationError}
          disabled={submitting}
          onChange={(event) => {
            setConfirmation(event.target.value);
            setConfirmationError(undefined);
          }}
        />

        {providers.isPending && (
          <p role="status" className="text-muted">
            Loading sign-in methods…
          </p>
        )}
        {providers.isError && (
          <div className="space-y-2">
            <Alert variant="error">Could not load your sign-in methods.</Alert>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void providers.refetch()}
            >
              Try again
            </Button>
          </div>
        )}
        {methods.length > 0 && (
          <ProofMethodChoice
            name="delete-account-method"
            methods={methods}
            value={method}
            hint=""
            disabled={submitting}
            onChange={(next) => {
              setChosen(next);
              setPassword('');
              setPasswordError(undefined);
              setFormError(undefined);
            }}
          />
        )}
        {methods.length > 0 && method === 'password' && (
          <PasswordField
            label="Current password"
            name="deleteAccountPassword"
            autoComplete="current-password"
            maxLength={128}
            value={password}
            error={passwordError}
            disabled={submitting}
            onChange={(event) => {
              setPassword(event.target.value);
              setPasswordError(undefined);
            }}
          />
        )}
        {methods.length > 0 && method === 'google' && (
          <div className="rounded-xl border border-line bg-app px-3.5 py-3">
            <p className="text-xs text-muted">
              Type {CONFIRMATION} above, then confirm with your linked Google
              account to delete your account.
            </p>
            <GoogleSignInButton
              disabled={submitting}
              onStart={() => {
                if (submitting) return undefined;
                setFormError(undefined);
                if (!checkConfirmation()) return undefined;
                return (credential) => submit({ googleCredential: credential });
              }}
            />
          </div>
        )}

        <div
          className={`grid gap-3 pt-1 ${method === 'password' && methods.length > 0 ? 'sm:grid-cols-2' : ''}`}
        >
          <Button
            variant="secondary"
            size="lg"
            disabled={submitting}
            onClick={close}
          >
            Cancel
          </Button>
          {method === 'password' && methods.length > 0 && (
            <Button
              type="submit"
              variant="danger"
              size="lg"
              disabled={submitting || !confirmed || !password}
              aria-busy={submitting || undefined}
            >
              {submitting ? 'Deleting…' : 'Delete account'}
            </Button>
          )}
        </div>
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
          <InfoIcon aria-hidden="true" className="size-4" />
          You will be signed out immediately after deletion.
        </p>
      </form>
    </Dialog>
  );
}
