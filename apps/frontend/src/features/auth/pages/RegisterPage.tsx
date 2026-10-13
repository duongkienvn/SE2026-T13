import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { RedirectState } from '../../../app/redirect';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { MailIcon, UserIcon } from '../../../components/icons';
import { PasswordField } from '../../../components/PasswordField';
import { TextField } from '../../../components/TextField';
import { register } from '../api';
import { AuthLayout, BrandLockup } from '../components/AuthLayout';
import { AuthSwitch } from '../components/AuthSwitch';
import { toFormErrors } from '../../../lib/form-errors';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { usePageTitle } from '../../../hooks/usePageTitle';
import {
  hasErrors,
  normalizeEmail,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validateDisplayName,
  validateEmail,
  validateNewPassword,
} from '../validation';

const FIELD_LABELS = {
  displayName: 'Display name',
  email: 'Email',
  password: 'Password',
  confirmPassword: 'Confirm password',
};
type Field = keyof typeof FIELD_LABELS;

export function RegisterPage() {
  usePageTitle('Create account');
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
  const navigate = useNavigate();
  const from = (useLocation().state as RedirectState | null)?.from;
  const [values, setValues] = useState<Record<Field, string>>({
    displayName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<Field, string>>
  >({});
  const [formError, setFormError] = useState<string>();

  const mutation = useMutation({
    mutationFn: register,
    // Registration does not sign the user in: continue to the login page.
    onSuccess: (user) => {
      const state: RedirectState = { registeredEmail: user.email, from };
      navigate('/login', { replace: true, state });
    },
    onError: (error) => {
      const result = toFormErrors(error, FIELD_LABELS);
      setFieldErrors(result.fieldErrors);
      setFormError(result.formError);
      focusFirstInvalid();
    },
  });

  const update = (field: Field) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;

    const errors = {
      displayName: validateDisplayName(values.displayName),
      email: validateEmail(values.email),
      password: validateNewPassword(values.password),
      confirmPassword:
        values.confirmPassword === values.password
          ? undefined
          : 'Passwords do not match.',
    };
    setFieldErrors(errors);
    setFormError(undefined);
    if (hasErrors(errors)) {
      focusFirstInvalid();
      return;
    }

    // confirmPassword is a client-side check only and is never sent.
    mutation.mutate({
      displayName: values.displayName.trim(),
      email: normalizeEmail(values.email),
      password: values.password,
    });
  };

  return (
    <AuthLayout>
      <BrandLockup />
      <h1 className="mt-10 text-[30px] leading-tight font-bold tracking-tight text-ink">
        Create your account
      </h1>
      <p className="mt-2 text-lg text-muted">
        Start organizing work with your team.
      </p>

      <form
        ref={formRef}
        noValidate
        onSubmit={handleSubmit}
        className="mt-7 space-y-4"
      >
        {formError && <Alert variant="error">{formError}</Alert>}

        <TextField
          label="Display name"
          name="displayName"
          autoComplete="name"
          placeholder="Your name"
          icon={<UserIcon />}
          value={values.displayName}
          onChange={update('displayName')}
          error={fieldErrors.displayName}
        />
        <TextField
          label="Email address"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@company.com"
          icon={<MailIcon />}
          value={values.email}
          onChange={update('email')}
          error={fieldErrors.email}
        />
        <PasswordField
          label="Password"
          name="password"
          autoComplete="new-password"
          placeholder="Create a password"
          hint={`${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.`}
          value={values.password}
          onChange={update('password')}
          error={fieldErrors.password}
        />
        <PasswordField
          label="Confirm password"
          name="confirmPassword"
          autoComplete="new-password"
          placeholder="Repeat your password"
          value={values.confirmPassword}
          onChange={update('confirmPassword')}
          error={fieldErrors.confirmPassword}
        />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <AuthSwitch
        prompt="Already have an account?"
        to="/login"
        action="Log in"
      />
    </AuthLayout>
  );
}
