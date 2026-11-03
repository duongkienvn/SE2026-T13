import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/TextField';
import { MailIcon } from '../../../components/icons';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { toFormErrors } from '../../../lib/form-errors';
import { forgotPassword } from '../api';
import { useAuthSession } from '../auth-session-context';
import { AuthEntryLayout } from '../components/AuthEntryLayout';
import { normalizeEmail, validateEmail } from '../validation';

export function ForgotPasswordPage() {
  usePageTitle('Forgot password');
  const scope = useAuthSession();
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(false), 60_000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || cooldown || !scope.isCurrent()) return;
    const invalid = validateEmail(email);
    setFieldError(invalid);
    setError(undefined);
    setAcknowledged(false);
    if (invalid) {
      focusFirstInvalid();
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      await forgotPassword(normalizeEmail(email));
      if (alive.current && scope.isCurrent()) {
        setAcknowledged(true);
        setCooldown(true);
      }
    } catch (failure) {
      if (!alive.current || !scope.isCurrent()) return;
      const result = toFormErrors(failure, { email: 'Email' });
      setFieldError(result.fieldErrors.email);
      setError(result.formError);
      focusFirstInvalid();
    } finally {
      busy.current = false;
      if (alive.current && scope.isCurrent()) setPending(false);
    }
  }
  return (
    <AuthEntryLayout kind="recovery">
      <h1>Forgot your password?</h1>
      <p className="auth-entry-intro">
        Enter your email address and we'll send you a link to reset your
        password.
      </p>
      <form
        ref={formRef}
        onSubmit={submit}
        noValidate
        className="auth-entry-form"
        aria-busy={pending}
      >
        {acknowledged && (
          <Alert variant="success">
            If this email is eligible, a recovery link may arrive. Delivery may
            be delayed or unavailable. Check your inbox and spam folder, or try
            again after 60 seconds.
          </Alert>
        )}
        {error && <Alert variant="error">{error}</Alert>}
        <TextField
          appearance="auth"
          icon={<MailIcon />}
          placeholder="you@company.com"
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldError}
          disabled={pending}
        />
        <Button
          type="submit"
          size="lg"
          className="auth-entry-submit"
          disabled={pending || cooldown}
        >
          {pending
            ? 'Requesting link…'
            : cooldown
              ? 'Wait 60 seconds to request again'
              : 'Send recovery link'}
        </Button>
      </form>
      <Link
        to="/login"
        className="mt-5 block text-center text-sm font-semibold text-primary underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        Back to login
      </Link>
    </AuthEntryLayout>
  );
}
