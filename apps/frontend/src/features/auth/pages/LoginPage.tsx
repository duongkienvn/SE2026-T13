import { useMutation } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { RedirectState } from '../../../app/redirect';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { MailIcon } from '../../../components/icons';
import { PasswordField } from '../../../components/PasswordField';
import { TextField } from '../../../components/TextField';
import { login } from '../api';
import { useAuthSession, type AuthSessionScope } from '../auth-session-context';
import type { LoginRequest } from '../types';
import { AuthEntryLayout } from '../components/AuthEntryLayout';
import { AuthSwitch } from '../components/AuthSwitch';
import { GoogleAuth } from '../components/GoogleAuth';
import { toFormErrors } from '../../../lib/form-errors';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { useAuth } from '../useAuth';
import { hasErrors, normalizeEmail, validateEmail } from '../validation';
import { isApiError } from '../../../lib/api-client';

const FIELD_LABELS = { email: 'Email', password: 'Password' };
type Field = keyof typeof FIELD_LABELS;

export function LoginPage() {
  usePageTitle('Log in');
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
  const { signIn } = useAuth();
  const scope = useAuthSession();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as RedirectState | null;
  // Registration feedback is shown once; it must not reappear on reload or back.
  const [registeredEmail] = useState(state?.registeredEmail);
  const [passwordUpdated, setPasswordUpdated] = useState(
    state?.passwordUpdated,
  );
  const [emailChanged, setEmailChanged] = useState(state?.emailChanged);
  const [email, setEmail] = useState(registeredEmail ?? '');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<Field, string>>
  >({});
  const [formError, setFormError] = useState<string>();
  const [needsVerification, setNeedsVerification] = useState(false);

  useEffect(() => {
    if (
      !state?.registeredEmail &&
      !state?.passwordUpdated &&
      !state?.emailChanged
    )
      return;
    // The protected-route logout redirect may mount Login before the explicit
    // success navigation arrives. Capture that later state before clearing it.
    if (state.passwordUpdated) setPasswordUpdated(true);
    if (state.emailChanged) setEmailChanged(true);
    const remaining: RedirectState = state.from ? { from: state.from } : {};
    const { pathname, search, hash } = location;
    navigate({ pathname, search, hash }, { replace: true, state: remaining });
  }, [state, location, navigate]);

  const mutation = useMutation({
    mutationFn: ({
      input,
      scope,
    }: {
      input: LoginRequest;
      scope: AuthSessionScope;
    }) => {
      if (!scope.isCurrent())
        throw new Error('Session changed before request.');
      return login(input);
    },
    // The public-only route guard then redirects to the intended page.
    onSuccess: (response, { scope }) => {
      if (scope.isCurrent()) signIn(response);
    },
    onError: (error, { scope }) => {
      if (!scope.isCurrent()) return;
      if (isApiError(error) && error.code === 'EMAIL_NOT_VERIFIED') {
        setFormError('Verify your email address before logging in.');
        setNeedsVerification(true);
        return;
      }
      const result = toFormErrors(error, FIELD_LABELS);
      setFieldErrors(result.fieldErrors);
      setFormError(result.formError);
      focusFirstInvalid();
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;

    const errors = {
      email: validateEmail(email),
      password: password ? undefined : 'Enter your password.',
    };
    setFieldErrors(errors);
    setFormError(undefined);
    setNeedsVerification(false);
    if (hasErrors(errors)) {
      focusFirstInvalid();
      return;
    }

    mutation.mutate({
      input: { email: normalizeEmail(email), password },
      scope,
    });
  };

  return (
    <AuthEntryLayout>
      <h1>Welcome back</h1>
      <p className="auth-entry-intro">Log in to your account to continue.</p>

      <form
        ref={formRef}
        noValidate
        onSubmit={handleSubmit}
        className="auth-entry-form"
        aria-busy={mutation.isPending}
      >
        {passwordUpdated && (
          <Alert variant="success">
            Password updated. Log in with your new password.
          </Alert>
        )}
        {emailChanged && (
          <Alert variant="success">
            Email updated. Log in with your new email address.
          </Alert>
        )}
        {formError && <Alert variant="error">{formError}</Alert>}
        {needsVerification && (
          <Link
            className="block font-semibold text-primary underline"
            to="/check-email"
            state={{
              registeredEmail: normalizeEmail(email),
              from: state?.from,
            }}
          >
            Resend verification email
          </Link>
        )}

        <TextField
          appearance="auth"
          label="Email address"
          icon={<MailIcon />}
          type="email"
          name="email"
          autoComplete="username"
          placeholder="you@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
        />
        <PasswordField
          appearance="auth"
          label="Password"
          name="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
        />

        <Link
          to="/forgot-password"
          className="auth-entry-recovery text-sm font-medium text-primary underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Forgot password?
        </Link>
        <Button
          type="submit"
          size="lg"
          className="auth-entry-submit"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Logging in…' : 'Log In'}
        </Button>
      </form>

      <GoogleAuth disabled={mutation.isPending} />
      <AuthSwitch
        prompt="Don't have an account?"
        to="/register"
        action="Create one"
      />
    </AuthEntryLayout>
  );
}
