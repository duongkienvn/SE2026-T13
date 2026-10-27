import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { UnsavedChangesGuard } from '../../../components/UnsavedChangesGuard';
import { MailIcon, UserIcon } from '../../../components/icons';
import { PageHeader } from '../../../components/PageHeader';
import { TextField } from '../../../components/TextField';
import { updateCurrentUser } from '../api';
import { currentUserQueryKey } from '../AuthProvider';
import { useAuthSession, type AuthSessionScope } from '../auth-session-context';
import { AvatarEditor } from '../components/AvatarEditor';
import { toFormErrors } from '../../../lib/form-errors';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { usePageTitle } from '../../../hooks/usePageTitle';
import type { UpdateProfileRequest, User } from '../types';
import { useAuth } from '../useAuth';
import { hasErrors, validateDisplayName } from '../validation';

const FIELD_LABELS = {
  displayName: 'Display name',
};
type Field = keyof typeof FIELD_LABELS;

/** Only fields that differ from the saved profile; `{}` means nothing changed. */
function buildPatch(user: User, displayName: string): UpdateProfileRequest {
  const patch: UpdateProfileRequest = {};
  const name = displayName.trim();
  if (name !== user.displayName) patch.displayName = name;
  return patch;
}

export function ProfilePage() {
  usePageTitle('Profile');
  const { user } = useAuth();
  const { generation } = useAuthSession();
  // Protected route: the guard only renders this page with a verified user.
  return user ? <ProfileForm key={generation} user={user} /> : null;
}

function ProfileForm({ user }: { user: User }) {
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
  const { runAuthorized } = useAuth();
  const scope = useAuthSession();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [photoDirty, setPhotoDirty] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<Field, string>>
  >({});
  const [formError, setFormError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: ({
      patch,
      scope,
    }: {
      patch: UpdateProfileRequest;
      scope: AuthSessionScope;
    }) => {
      if (!scope.isCurrent())
        throw new Error('Session changed before request.');
      return runAuthorized((token) => updateCurrentUser(token, patch));
    },
    onSuccess: async (updated, { scope }) => {
      if (!scope.isCurrent()) return;
      await queryClient.cancelQueries({ queryKey: currentUserQueryKey });
      if (!scope.isCurrent()) return;
      queryClient.setQueryData<User>(currentUserQueryKey, (current) =>
        current?.id === updated.id
          ? { ...current, displayName: updated.displayName }
          : current,
      );
      setDisplayName(updated.displayName);
      setSaved(true);
    },
    onError: (error, { scope }) => {
      if (!scope.isCurrent()) return;
      const result = toFormErrors(error, FIELD_LABELS);
      setFieldErrors(result.fieldErrors);
      setFormError(result.formError);
      focusFirstInvalid();
    },
  });

  const patch = buildPatch(user, displayName);
  const isDirty = Object.keys(patch).length > 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending || !isDirty) return;

    const errors = {
      displayName: validateDisplayName(displayName),
    };
    setFieldErrors(errors);
    setFormError(undefined);
    setSaved(false);
    if (hasErrors(errors)) {
      focusFirstInvalid();
      return;
    }

    mutation.mutate({ patch, scope });
  };

  return (
    <>
      <PageHeader
        title="Profile"
        description="Manage how you appear to other members of your boards."
      />

      <form
        ref={formRef}
        noValidate
        onSubmit={handleSubmit}
        className="mt-6 max-w-2xl space-y-6 rounded-xl border border-line bg-surface p-5 shadow-card md:p-6"
      >
        <AvatarEditor
          user={user}
          onDirtyChange={setPhotoDirty}
          onBusyChange={setPhotoBusy}
        />

        <div className="min-w-0">
          <div className="space-y-4">
            {saved && !isDirty && (
              <Alert variant="success">Profile updated.</Alert>
            )}
            {formError && <Alert variant="error">{formError}</Alert>}

            <div className="space-y-4">
              <TextField
                label="Email address"
                type="email"
                icon={<MailIcon />}
                value={user.email}
                readOnly
                disabled
                hint="Email cannot be changed."
              />
              <TextField
                label="Display name"
                name="displayName"
                autoComplete="name"
                icon={<UserIcon />}
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setSaved(false);
                }}
                error={fieldErrors.displayName}
              />
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <Button type="submit" disabled={!isDirty || mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </form>
      <UnsavedChangesGuard
        when={(isDirty && !mutation.isPending) || photoDirty || photoBusy}
        description="Your profile edits have not been saved."
      />
    </>
  );
}
