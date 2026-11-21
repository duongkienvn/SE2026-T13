import { isUuid } from '../../infrastructure/auth/credential-record.ts';
import { ApiError } from '../../infrastructure/api/errors.ts';

export interface Profile {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly avatarRevision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid account response');
  return value as Record<string, unknown>;
}
export function exact(value: Record<string, unknown>, keys: readonly string[]) {
  if (
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in value))
  )
    throw new Error('Invalid account response');
}
export function date(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
export function validDisplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Array.from(value.trim()).length >= 2 &&
    Array.from(value.trim()).length <= 80
  );
}
export function displayNamePatch(value: unknown) {
  if (!validDisplayName(value))
    throw new ApiError('http', { status: 400, code: 'INVALID_DISPLAY_NAME' });
  return { displayName: value.trim() };
}
export function decodeProfile(input: unknown): Profile {
  const v = object(input);
  exact(v, [
    'id',
    'email',
    'displayName',
    'avatarUrl',
    'avatarRevision',
    'createdAt',
    'updatedAt',
  ]);
  if (
    !isUuid(v.id) ||
    v.id.length !== 36 ||
    typeof v.email !== 'string' ||
    !v.email ||
    v.email.length > 254 ||
    !validDisplayName(v.displayName) ||
    (v.avatarUrl !== null &&
      (typeof v.avatarUrl !== 'string' || v.avatarUrl.length > 2048)) ||
    !Number.isSafeInteger(v.avatarRevision) ||
    (v.avatarRevision as number) < 0 ||
    (v.avatarRevision as number) > 2147483646 ||
    !date(v.createdAt) ||
    !date(v.updatedAt)
  )
    throw new Error('Invalid account response');
  return {
    id: v.id.toLowerCase(),
    email: v.email,
    displayName: v.displayName,
    avatarUrl: v.avatarUrl as string | null,
    avatarRevision: v.avatarRevision as number,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}
/** Legacy external images are deliberately initials-only: no verified native source policy. */
export function privateAvatarPath(
  value: string | null,
  ownId: string,
): string | null {
  if (!value || /[\p{Cc}%?#\\]/u.test(value)) return null;
  const match = /^\/users\/([^/]+)\/avatar\/([^/]+)$/.exec(value);
  return match && isUuid(match[1]) && isUuid(match[2]) && match[1] === ownId
    ? value
    : null;
}
export type ProfileDraft = { saved: Profile; text: string; conflict: boolean };
export const beginProfile = (saved: Profile): ProfileDraft => ({
  saved,
  text: saved.displayName,
  conflict: false,
});
export function receiveProfile(
  draft: ProfileDraft,
  saved: Profile,
): ProfileDraft {
  if (draft.text.trim() === draft.saved.displayName) return beginProfile(saved);
  return {
    saved,
    text: draft.text,
    conflict: draft.conflict || draft.saved.displayName !== saved.displayName,
  };
}
