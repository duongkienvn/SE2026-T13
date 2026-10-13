import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Alert } from '../../../components/Alert';
import { Button } from '../../../components/Button';
import { MailIcon, UserIcon } from '../../../components/icons';
import { PageContainer } from '../../../components/PageContainer';
import { PageHeader } from '../../../components/PageHeader';
import { TextField } from '../../../components/TextField';
import { updateCurrentUser } from '../api';
import { currentUserQueryKey } from '../AuthProvider';
import { UserAvatar } from '../components/UserAvatar';
import { toFormErrors } from '../../../lib/form-errors';
import { useFocusFirstInvalid } from '../../../hooks/useFocusFirstInvalid';
import { usePageTitle } from '../../../hooks/usePageTitle';
import type { UpdateProfileRequest, User } from '../types';
import { useAuth } from '../useAuth';
import {
  hasErrors,
  validateAvatarUrl,
  validateDisplayName,
} from '../validation';

const FIELD_LABELS = {
  displayName: 'Display name',
  avatarUrl: 'Avatar URL',
};
type Field = keyof typeof FIELD_LABELS;

/** Only fields that differ from the saved profile; `{}` means nothing changed. */
function buildPatch(
  user: User,
  displayName: string,
  avatarUrl: string,
): UpdateProfileRequest {
  const patch: UpdateProfileRequest = {};
  const name = displayName.trim();
  const avatar = avatarUrl.trim() || null;
  if (name !== user.displayName) patch.displayName = name;
  if (avatar !== user.avatarUrl) patch.avatarUrl = avatar;
  return patch;
}

export function ProfilePage() {
  usePageTitle('Profile');
  const { user } = useAuth();
  // Protected route: the guard only renders this page with a verified user.
  return user ? <ProfileForm user={user} /> : null;
}

function ProfileForm({ user }: { user: User }) {
  const { formRef, focusFirstInvalid } = useFocusFirstInvalid();
  const { runAuthorized } = useAuth();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? '');
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<Field, string>>
  >({});
  const [formError, setFormError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: (patch: UpdateProfileRequest) =>
      runAuthorized((token) => updateCurrentUser(token, patch)),
    onSuccess: (updated) => {
      queryClient.setQueryData(currentUserQueryKey, updated);
      setDisplayName(updated.displayName);
      setAvatarUrl(updated.avatarUrl ?? '');
      setSaved(true);
    },
    onError: (error) => {
      const result = toFormErrors(error, FIELD_LABELS);
      setFieldErrors(result.fieldErrors);
      setFormError(result.formError);
      focusFirstInvalid();
    },
  });

  const patch = buildPatch(user, displayName, avatarUrl);
  const isDirty = Object.keys(patch).length > 0;
  const previewUrl = validateAvatarUrl(avatarUrl)
    ? null
    : avatarUrl.trim() || null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending || !isDirty) return;

    const errors = {
      displayName: validateDisplayName(displayName),
      avatarUrl: validateAvatarUrl(avatarUrl),
    };
    setFieldErrors(errors);
    setFormError(undefined);
    setSaved(false);
    if (hasErrors(errors)) {
      focusFirstInvalid();
      return;
    }

    mutation.mutate(patch);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Profile"
        description="Manage how you appear to other members of your boards."
      />

      <form
        ref={formRef}
        noValidate
        onSubmit={handleSubmit}
        className="mt-8 max-w-2xl rounded-xl border border-line bg-surface p-6 shadow-card md:p-8"
      >
        <div className="flex items-center gap-4">
          <UserAvatar
            user={{
              displayName: displayName.trim() || user.displayName,
              avatarUrl: previewUrl,
            }}
            className="size-16 text-xl"
          />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-ink">
              {user.displayName}
            </p>
            <p className="truncate text-[15px] text-muted">{user.email}</p>
          </div>
        </div>

        <div className="mt-8 space-y-5">
          {saved && !isDirty && (
            <Alert variant="success">Profile updated.</Alert>
          )}
          {formError && <Alert variant="error">{formError}</Alert>}

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
          <TextField
            label="Avatar URL"
            name="avatarUrl"
            type="url"
            inputMode="url"
            placeholder="https://example.com/avatar.png"
            hint="Optional. Leave empty to use your initials."
            value={avatarUrl}
            onChange={(event) => {
              setAvatarUrl(event.target.value);
              setSaved(false);
            }}
            error={fieldErrors.avatarUrl}
          />
        </div>

        <div className="mt-8 flex justify-end">
          <Button type="submit" disabled={!isDirty || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </PageContainer>
  );
}
