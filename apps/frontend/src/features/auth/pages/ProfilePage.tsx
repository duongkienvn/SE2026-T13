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
import { toFormErrors } from '../errors';
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
        className="mt-6 grid max-w-4xl gap-6 rounded-xl border border-line bg-surface p-5 shadow-card md:grid-cols-[200px_1fr] md:p-6"
      >
        {/* Identity on the left, editable fields on the right, so the page fits without scrolling. */}
        <div className="flex min-w-0 items-center gap-4 md:flex-col md:items-start md:border-r md:border-line md:pr-6">
          <UserAvatar
            user={{
              displayName: displayName.trim() || user.displayName,
              avatarUrl: previewUrl,
            }}
            className="size-16 text-xl md:size-20 md:text-2xl"
          />
          <div className="min-w-0 max-w-full">
            <p className="truncate text-base font-semibold text-ink">
              {user.displayName}
            </p>
            <p className="truncate text-sm text-muted">{user.email}</p>
          </div>
        </div>

        <div className="min-w-0">
          <div className="space-y-4">
            {saved && !isDirty && (
              <Alert variant="success">Profile updated.</Alert>
            )}
            {formError && <Alert variant="error">{formError}</Alert>}

            <div className="grid items-start gap-4 lg:grid-cols-2">
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

          <div className="mt-5 flex justify-end">
            <Button type="submit" disabled={!isDirty || mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </form>
    </PageContainer>
  );
}
