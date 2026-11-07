import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import {
  CheckCircleIcon,
  ClockIcon,
  MailIcon,
} from '../../../components/icons';
import { PasswordField } from '../../../components/PasswordField';
import { TextField } from '../../../components/TextField';
import { ClientErrorCode, isApiError } from '../../../lib/api-client';
import {
  getLinkedProviders,
  getPendingEmailChange,
  GoogleProofRejectedError,
  requestEmailChange,
} from '../../auth/api';
import { useAuthSession } from '../../auth/auth-session-context';
import { GoogleSignInButton } from '../../auth/components/GoogleSignInButton';
import {
  availableProofMethods,
  ProofMethodChoice,
  type ProofMethod,
} from '../../auth/components/ProofMethodChoice';
import { useAuth } from '../../auth/useAuth';
import { normalizeEmail, validateEmail } from '../../auth/validation';
import { InfoStrip } from '../data-privacy/ExportCard';
import { securityCardClass, SecurityCardHeader } from './SecurityCard';

/** The server's per-account issuance cooldown; mirrored only as a UI pause. */
export const EMAIL_CHANGE_COOLDOWN_MS = 60_000;

type Errors = { newEmail?: string; currentPassword?: string };

export const pendingEmailChangeKey = (generation: number) =>
  ['auth', 'email-change-pending', generation] as const;

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1_000));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function requestErrorMessage(
  error: unknown,
  method: ProofMethod,
  hasPassword: boolean,
): { form?: string; fields?: Errors } {
  if (error instanceof GoogleProofRejectedError)
    return {
      form: 'Google couldn’t confirm your identity. Verify again with your linked Google account.',
    };
  if (!isApiError(error))
    return { form: 'Your request could not be sent. Please try again.' };
  if (error.code === ClientErrorCode.NETWORK_ERROR)
    return {
      form: 'Could not reach the server. Check your connection and try again.',
    };
  if (error.status === 403)
    return method === 'password'
      ? { fields: { currentPassword: 'Your current password is incorrect.' } }
      : {
          form: 'This Google account isn’t the one linked to your Kanvexa account.',
        };
  if (error.status === 400)
    return { fields: { newEmail: 'Check the new email address.' } };
  if (error.status === 429)
    return { form: 'Too many attempts. Wait a few minutes and try again.' };
  if (error.status === 503)
    return {
      form: hasPassword
        ? 'Google verification is unavailable right now. Use your password or try again later.'
        : 'Google verification is unavailable right now. Please try again later.',
    };
  return { form: 'Your request could not be sent. Please try again later.' };
}

/**
 * Settings → Security → Change email (#217 contract). A request needs fresh
 * proof every time; the server answers a generic 202 that guarantees neither
 * delivery nor a pending change, so the UI never claims an email was sent.
 */
export function ChangeEmailCard() {
  const { user, runAuthorized } = useAuth();
  const scope = useAuthSession();
  const queryClient = useQueryClient();
  const providers = useQuery({
    queryKey: ['auth', 'linked-providers', scope.generation],
    queryFn: ({ signal }) =>
      runAuthorized((token) => getLinkedProviders(token, signal)),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const pendingKey = pendingEmailChangeKey(scope.generation);
  const pending = useQuery({
    queryKey: pendingKey,
    queryFn: ({ signal }) =>
      runAuthorized((token) => getPendingEmailChange(token, signal)),
    retry: false,
  });

  const [chosen, setChosen] = useState<ProofMethod>('password');
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [acceptedAt, setAcceptedAt] = useState<number | null>(null);
  const [anotherLink, setAnotherLink] = useState(false);
  const busy = useRef(false);
  const alive = useRef(false);
  const section = useRef<HTMLElement>(null);
  const focusField = (name: 'newEmail' | 'emailChangePassword') =>
    section.current
      ?.querySelector<HTMLInputElement>(`input[name="${name}"]`)
      ?.focus();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const summary = pending.data ?? null;
  const expiresAt = summary ? Date.parse(summary.expiresAt) : 0;
  const now = useNow(!!summary || acceptedAt !== null);
  const pendingVisible = !!summary && expiresAt > now;
  const cooldownLeft =
    acceptedAt === null ? 0 : acceptedAt + EMAIL_CHANGE_COOLDOWN_MS - now;
  const coolingDown = cooldownLeft > 0;

  // An expired intent disappears; ask the server again instead of guessing.
  const refetchPending = pending.refetch;
  useEffect(() => {
    if (summary && expiresAt <= now) void refetchPending();
  }, [summary, expiresAt, now, refetchPending]);

  const methods = providers.data ? availableProofMethods(providers.data) : [];
  const method = methods.includes(chosen) ? chosen : (methods[0] ?? 'password');
  const hasPassword = providers.data?.hasPassword === true;
  const locked = submitting || coolingDown;

  /** Client checks only; the server stays authoritative and generic. */
  const validate = (): string | null => {
    const next: Errors = {};
    next.newEmail = validateEmail(newEmail);
    if (
      !next.newEmail &&
      user &&
      normalizeEmail(newEmail) === normalizeEmail(user.email)
    )
      next.newEmail = 'This is already your email address.';
    if (method === 'password' && !password)
      next.currentPassword = 'Enter your current password.';
    setErrors(next);
    if (next.newEmail) focusField('newEmail');
    else if (next.currentPassword) focusField('emailChangePassword');
    return next.newEmail || next.currentPassword
      ? null
      : normalizeEmail(newEmail);
  };

  const send = async (
    proof: { currentPassword: string } | { googleCredential: string },
    target: string,
  ) => {
    if (busy.current || !scope.isCurrent()) return;
    busy.current = true;
    setSubmitting(true);
    setFormError(undefined);
    setAcceptedAt(null);
    try {
      await runAuthorized((token) =>
        requestEmailChange(token, { newEmail: target, ...proof }),
      );
      if (!alive.current || !scope.isCurrent()) return;
      setNewEmail('');
      setPassword('');
      setErrors({});
      setAnotherLink(false);
      setAcceptedAt(Date.now());
      void queryClient.invalidateQueries({ queryKey: pendingKey });
    } catch (error) {
      if (!alive.current || !scope.isCurrent()) return;
      setPassword('');
      const result = requestErrorMessage(error, method, hasPassword);
      setErrors(result.fields ?? {});
      setFormError(result.form);
      if (result.fields?.currentPassword) focusField('emailChangePassword');
      else if (result.fields?.newEmail) focusField('newEmail');
    } finally {
      busy.current = false;
      if (alive.current) setSubmitting(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (method !== 'password' || locked) return;
    const target = validate();
    if (target) void send({ currentPassword: password }, target);
  };

  return (
    <section
      ref={section}
      aria-labelledby="change-email-heading"
      className={securityCardClass}
    >
      <SecurityCardHeader
        id="change-email-heading"
        title="Change email"
        description="Update your email address. We’ll send a confirmation link to the new address."
        icon={MailIcon}
      />

      <div className="mt-2.5 space-y-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <TextField
            density="compact"
            label="Current email"
            type="email"
            icon={<MailIcon />}
            value={user?.email ?? ''}
            readOnly
            className="sm:flex-1"
          />
          <span className="inline-flex h-7 shrink-0 items-center gap-1.5 self-start rounded-full bg-success/10 px-2.5 text-xs font-semibold text-success sm:mb-0.5 sm:self-auto">
            <CheckCircleIcon className="size-4" />
            Verified
          </span>
        </div>

        {providers.isPending && (
          <p role="status" className="text-sm text-muted">
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
          <form noValidate onSubmit={onSubmit} className="space-y-2.5">
            <ProofMethodChoice
              name="email-change-method"
              methods={methods}
              value={method}
              disabled={submitting}
              onChange={(next) => {
                setChosen(next);
                setPassword('');
                setErrors({});
                setFormError(undefined);
              }}
            />
            {formError && <Alert variant="error">{formError}</Alert>}
            {method === 'password' && (
              <PasswordField
                density="compact"
                label="Current password"
                name="emailChangePassword"
                autoComplete="current-password"
                maxLength={128}
                value={password}
                error={errors.currentPassword}
                disabled={submitting}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setErrors((old) => ({ ...old, currentPassword: undefined }));
                }}
              />
            )}
            <TextField
              density="compact"
              label="New email"
              type="email"
              name="newEmail"
              autoComplete="email"
              icon={<MailIcon />}
              placeholder="Enter your new email address"
              maxLength={254}
              value={newEmail}
              error={errors.newEmail}
              hint={
                anotherLink
                  ? 'Enter the new address again and confirm your identity to request another link.'
                  : undefined
              }
              disabled={submitting}
              onChange={(event) => {
                setNewEmail(event.target.value);
                setErrors((old) => ({ ...old, newEmail: undefined }));
              }}
            />
            {method === 'password' ? (
              <Button type="submit" size="sm" disabled={locked}>
                <MailIcon className="size-4.5" />
                {submitting ? 'Sending…' : 'Send verification link'}
              </Button>
            ) : (
              <div className="rounded-xl border border-line bg-app px-3.5 py-3">
                <p className="text-sm font-semibold text-ink">
                  Verify with Google
                </p>
                <p className="text-xs text-muted">
                  Enter the new email above, then confirm with your linked
                  Google account. Google opens in a popup.
                </p>
                <GoogleSignInButton
                  disabled={locked}
                  onStart={() => {
                    if (locked) return undefined;
                    setFormError(undefined);
                    const target = validate();
                    if (!target) return undefined;
                    return (credential) =>
                      send({ googleCredential: credential }, target);
                  }}
                />
              </div>
            )}
            {coolingDown && (
              <p className="text-xs text-muted">
                You can request another link in {formatRemaining(cooldownLeft)}.
              </p>
            )}
          </form>
        )}

        {acceptedAt !== null && (
          <div role="status">
            <Alert variant="success">
              Request received. If this address can be used, a confirmation link
              may arrive there. Open it while signed in to this account.
            </Alert>
          </div>
        )}

        {pendingVisible && summary && (
          <div
            role="group"
            aria-labelledby="email-change-pending-heading"
            className="flex flex-col gap-3 rounded-xl border border-line px-3.5 py-2.5 sm:flex-row sm:items-center"
          >
            <ClockIcon
              aria-hidden="true"
              className="size-5 shrink-0 text-primary"
            />
            <div className="min-w-0 flex-1 text-sm">
              <p
                id="email-change-pending-heading"
                className="font-semibold text-ink"
              >
                Email change pending
              </p>
              <p className="text-muted">
                A confirmation link for{' '}
                <span className="font-medium text-ink">
                  {summary.maskedNewEmail}
                </span>{' '}
                may be in that mailbox. It expires in{' '}
                <span className="tabular-nums">
                  {formatRemaining(expiresAt - now)}
                </span>
                .
              </p>
            </div>
            {methods.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                disabled={locked}
                onClick={() => {
                  setAnotherLink(true);
                  setAcceptedAt(null);
                  focusField('newEmail');
                }}
              >
                Request another link
              </Button>
            )}
          </div>
        )}

        <InfoStrip>
          Your email changes only after you open the link from the new mailbox
          while signed in here. You will then sign in again.
        </InfoStrip>
      </div>
    </section>
  );
}
