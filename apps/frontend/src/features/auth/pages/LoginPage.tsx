import { useMutation } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { RedirectState } from '../../../app/redirect';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { MailIcon } from '../../../components/icons';
import { PasswordField } from '../../../components/PasswordField';
import { TextField } from '../../../components/TextField';
import { login } from '../api';
import { AuthLayout, BrandLockup } from '../components/AuthLayout';
import { AuthSwitch } from '../components/AuthSwitch';
import { toFormErrors } from '../errors';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { useAuth } from '../useAuth';
import { hasErrors, normalizeEmail, validateEmail } from '../validation';

const FIELD_LABELS = { email: 'Email', password: 'Password' };
type Field = keyof typeof FIELD_LABELS;

export function LoginPage() {
  usePageTitle('Log in');
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
  const { signIn } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as RedirectState | null;
  // Registration feedback is shown once; it must not reappear on reload or back.
  const [registeredEmail] = useState(state?.registeredEmail);
  const [email, setEmail] = useState(registeredEmail ?? '');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<Field, string>>
  >({});
  const [formError, setFormError] = useState<string>();

  useEffect(() => {
    if (!state?.registeredEmail) return;
    const remaining: RedirectState = state.from ? { from: state.from } : {};
    navigate(location.pathname, { replace: true, state: remaining });
  }, [state, location.pathname, navigate]);

  const mutation = useMutation({
    mutationFn: login,
    // The public-only route guard then redirects to the intended page.
    onSuccess: signIn,
    onError: (error) => {
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
    if (hasErrors(errors)) {
      focusFirstInvalid();
      return;
    }

    mutation.mutate({ email: normalizeEmail(email), password });
  };

  return (
    <AuthLayout>
      <BrandLockup />
      <h1 className="mt-14 text-[30px] leading-tight font-bold tracking-tight text-ink">
        Welcome back
      </h1>
      <p className="mt-2 text-lg text-muted">
        Log in to your account to continue.
      </p>

      <form
        ref={formRef}
        noValidate
        onSubmit={handleSubmit}
        className="mt-9 space-y-6"
      >
        {registeredEmail && !formError && (
          <Alert variant="success">Account created. Log in to continue.</Alert>
        )}
        {formError && <Alert variant="error">{formError}</Alert>}

        <TextField
          label="Email address"
          type="email"
          name="email"
          autoComplete="username"
          placeholder="you@company.com"
          icon={<MailIcon />}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
        />
        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
        />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Logging in…' : 'Log In'}
        </Button>
      </form>

      <AuthSwitch
        prompt="Don't have an account?"
        to="/register"
        action="Create one"
      />
    </AuthLayout>
  );
}
