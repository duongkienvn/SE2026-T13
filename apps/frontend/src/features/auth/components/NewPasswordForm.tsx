import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { PasswordField } from '../../../components/PasswordField';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { isApiError } from '../../../lib/api-client';
import { toFormErrors } from '../../../lib/form-errors';
import { useAuthSession } from '../auth-session-context';
import { hasErrors, validateNewPassword } from '../validation';
import { PasswordRequirements } from './PasswordRequirements';

const labels = {
  currentPassword: 'Current password',
  newPassword: 'New password',
  confirmPassword: 'Confirm password',
};
type Field = keyof typeof labels;

/** Shared by public recovery and the authenticated Security section. */
export function NewPasswordForm({
  requireCurrent = false,
  submit,
  onSuccess,
}: {
  requireCurrent?: boolean;
  submit: (newPassword: string, currentPassword: string) => Promise<void>;
  onSuccess: () => void;
}) {
  const scope = useAuthSession();
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
  const requirementsId = useId();
  const [values, setValues] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [invalidToken, setInvalidToken] = useState(false);
  const update = (field: Field) => (event: { target: { value: string } }) =>
    setValues((old) => ({ ...old, [field]: event.target.value }));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || invalidToken || !scope.isCurrent()) return;
    const nextErrors = {
      currentPassword:
        requireCurrent && !values.currentPassword
          ? 'Enter your current password.'
          : undefined,
      newPassword:
        validateNewPassword(values.newPassword) ??
        (requireCurrent && values.currentPassword === values.newPassword
          ? 'Choose a password different from your current password.'
          : undefined),
      confirmPassword:
        values.confirmPassword === values.newPassword
          ? undefined
          : 'Passwords do not match.',
    };
    setErrors(nextErrors);
    setError(undefined);
    if (hasErrors(nextErrors)) {
      focusFirstInvalid();
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      await submit(values.newPassword, values.currentPassword);
      if (!alive.current || !scope.isCurrent()) return;
      setValues({ currentPassword: '', newPassword: '', confirmPassword: '' });
      onSuccess();
    } catch (failure) {
      if (!alive.current || !scope.isCurrent()) return;
      const result = toFormErrors(failure, labels);
      if (
        isApiError(failure) &&
        failure.code === 'INVALID_PASSWORD_RESET_TOKEN'
      ) {
        setInvalidToken(true);
        setError(
          'This recovery link is invalid or expired. Request a new link.',
        );
      } else if (
        isApiError(failure) &&
        failure.code === 'CURRENT_PASSWORD_INCORRECT'
      ) {
        setErrors({
          currentPassword: 'Could not confirm your current password.',
        });
      } else if (isApiError(failure) && failure.code === 'PASSWORD_REUSED') {
        setErrors({
          newPassword:
            'Choose a password different from your current password.',
        });
      } else {
        setErrors(result.fieldErrors);
        setError(result.formError);
      }
      focusFirstInvalid();
    } finally {
      busy.current = false;
      if (alive.current && scope.isCurrent()) setPending(false);
    }
  }
  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="mt-6 space-y-4"
      aria-busy={pending}
    >
      {error && <Alert variant="error">{error}</Alert>}
      {requireCurrent && (
        <PasswordField
          label="Current password"
          name="currentPassword"
          autoComplete="current-password"
          value={values.currentPassword}
          onChange={update('currentPassword')}
          error={errors.currentPassword}
          disabled={pending || invalidToken}
        />
      )}
      <PasswordField
        label="New password"
        name="newPassword"
        autoComplete="new-password"
        value={values.newPassword}
        onChange={update('newPassword')}
        error={errors.newPassword}
        aria-describedby={requirementsId}
        disabled={pending || invalidToken}
      />
      <PasswordRequirements id={requirementsId} password={values.newPassword} />
      <PasswordField
        label="Confirm password"
        name="confirmPassword"
        autoComplete="new-password"
        value={values.confirmPassword}
        onChange={update('confirmPassword')}
        error={errors.confirmPassword}
        disabled={pending || invalidToken}
      />
      <Button
        type="submit"
        disabled={pending || invalidToken}
        className="w-full"
      >
        {pending
          ? 'Saving password…'
          : requireCurrent
            ? 'Change password'
            : 'Save password'}
      </Button>
    </form>
  );
}
