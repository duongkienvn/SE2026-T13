import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import type { RedirectState } from '../../../app/redirect';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/TextField';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { isApiError } from '../../../lib/api-client';
import { resendVerification } from '../api';
import { useAuthSession } from '../auth-session-context';
import { AuthLayout } from '../components/AuthLayout';
import { normalizeEmail, validateEmail } from '../validation';

export function CheckEmailPage() {
  usePageTitle('Check your email');
  const state = useLocation().state as RedirectState | null;
  const scope = useAuthSession();
  const [email, setEmail] = useState(state?.registeredEmail ?? '');
  const [cooldown, setCooldown] = useState(
    state?.verificationRequested ? 60 : 0,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(
    state?.mailUnavailable
      ? 'Your account was created, but email could not be requested. Please resend after the cooldown.'
      : undefined,
  );
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || cooldown) return;
    const invalid = validateEmail(email);
    setError(invalid);
    setMessage(undefined);
    if (invalid) return;
    setPending(true);
    try {
      await resendVerification(normalizeEmail(email));
      if (scope.isCurrent()) {
        setMessage(
          'If this account needs verification, an email may arrive. Check spam too. Delivery may be delayed or unavailable; try again after 60 seconds.',
        );
        setCooldown(60);
      }
    } catch (error) {
      if (scope.isCurrent()) {
        setError(
          isApiError(error) && error.status === 429
            ? 'Too many requests. Please wait before trying again.'
            : 'Could not request verification. Please try again later.',
        );
        setCooldown(60);
      }
    } finally {
      if (scope.isCurrent()) setPending(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold text-ink">Check your email</h1>
      <p className="mt-3 text-muted">
        Open your Kanvexa verification email to continue. Links expire after 24
        hours. Check your spam folder if needed.
      </p>
      <form
        className="mt-6 space-y-4"
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        {message && <Alert variant="success">{message}</Alert>}
        {error && <Alert variant="error">{error}</Alert>}
        <TextField
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button
          type="submit"
          className="w-full"
          disabled={pending || cooldown > 0}
        >
          {pending
            ? 'Requesting email…'
            : cooldown
              ? `Resend in ${cooldown}s`
              : 'Resend verification email'}
        </Button>
        <p className="text-sm text-muted">
          For your privacy, this page does not confirm account existence or
          email delivery.
        </p>
      </form>
      <Link
        className="mt-5 block font-semibold text-primary underline"
        to="/login"
        state={{ from: state?.from, registeredEmail: normalizeEmail(email) }}
      >
        Back to login
      </Link>
    </AuthLayout>
  );
}
