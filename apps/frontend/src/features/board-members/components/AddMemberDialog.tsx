import { useState, type FormEvent } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { MailIcon } from '../../../components/icons';
import { TextField } from '../../../components/TextField';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { BOARD_ARCHIVED, isApiError } from '../../../lib/api-client';
import { toFormErrors } from '../../../lib/form-errors';
import { normalizeEmail, validateEmail } from '../../auth/validation';
import { useAddMember } from '../hooks';

interface AddMemberDialogProps {
  boardId: string;
  boardName: string;
  open: boolean;
  onClose: () => void;
  onAdded: (email: string) => void;
}

/** Adds an already registered user by email. No invitations are sent (MVP). */
export function AddMemberDialog({
  boardId,
  boardName,
  open,
  onClose,
  onAdded,
}: AddMemberDialogProps) {
  const add = useAddMember(boardId);
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [formError, setFormError] = useState<string>();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (add.isPending) return;

    const error = validateEmail(email);
    setEmailError(error);
    setFormError(undefined);
    if (error) {
      focusFirstInvalid();
      return;
    }

    const normalized = normalizeEmail(email);
    add.mutate(
      { email: normalized },
      {
        onSuccess: () => onAdded(normalized),
        onError: (failure) => {
          // Membership-specific meanings first; the generic mapper would call a
          // 409 "email already registered", which is wrong here.
          if (isApiError(failure) && failure.status === 404) {
            setEmailError('No registered user has this email address.');
          } else if (
            isApiError(failure) &&
            failure.status === 409 &&
            failure.code !== BOARD_ARCHIVED
          ) {
            setEmailError('This person is already a member of this board.');
          } else {
            const result = toFormErrors(failure, { email: 'Email' });
            setEmailError(result.fieldErrors.email);
            setFormError(result.formError);
          }
          focusFirstInvalid();
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add member"
      description={`Add someone who already has an account to “${boardName}”. They join as a member.`}
      dismissible={!add.isPending}
    >
      <form
        ref={formRef}
        noValidate
        onSubmit={handleSubmit}
        className="space-y-5"
      >
        {formError && <Alert variant="error">{formError}</Alert>}
        <TextField
          label="Email address"
          type="email"
          name="email"
          autoComplete="off"
          placeholder="teammate@company.com"
          icon={<MailIcon />}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            // An error about the old address no longer applies.
            setEmailError(undefined);
            setFormError(undefined);
          }}
          error={emailError}
          data-autofocus
        />
        <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={add.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={add.isPending}>
            {add.isPending ? 'Adding…' : 'Add member'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
