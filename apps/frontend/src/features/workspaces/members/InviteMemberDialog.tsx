import { useState, type FormEvent } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { Dialog } from '../../../components/Dialog';
import { MailIcon } from '../../../components/icons';
import { TextField } from '../../../components/TextField';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { normalizeEmail, validateEmail } from '../../auth/validation';
import { useInviteWorkspaceMember } from './hooks';
import { inviteError } from './invitation-text';
import type { WorkspaceInvitation } from './types';

/** Team ADMIN invite. Invitations grant MEMBER only; promote after joining. */
export function InviteMemberDialog({
  workspaceId,
  workspaceName,
  onClose,
  onInvited,
}: {
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
  onInvited: (invitation: WorkspaceInvitation) => void;
}) {
  const invite = useInviteWorkspaceMember(workspaceId);
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [formError, setFormError] = useState<string>();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (invite.isPending) return;
    const error = validateEmail(email);
    setEmailError(
      error === 'Enter your email address.' ? 'Enter an email address.' : error,
    );
    setFormError(undefined);
    if (error) {
      focusFirstInvalid();
      return;
    }
    invite.mutate(normalizeEmail(email), {
      onSuccess: (invitation) => {
        if (invite.isCurrent()) onInvited(invitation);
      },
      onError: (failure) => {
        const result = inviteError(failure);
        setEmailError(result.field);
        setFormError(result.form);
        focusFirstInvalid();
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Invite member"
      description={`Invite someone to join “${workspaceName}”. They must sign in with this email address to accept.`}
      dismissible={!invite.isPending}
    >
      <form ref={formRef} noValidate onSubmit={submit} className="space-y-5">
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
            setEmailError(undefined);
            setFormError(undefined);
          }}
          error={emailError}
          data-autofocus
        />
        <div>
          <p className="text-sm font-medium text-ink">Role</p>
          <p className="mt-1.5 flex min-h-11 items-center rounded-lg border border-line bg-app/50 px-3 text-sm text-ink">
            Member
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            Invitations always add a member. An admin can promote them after
            they join. The invitation expires after 7 days.
          </p>
        </div>
        <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={invite.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? 'Sending…' : 'Send invitation'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
