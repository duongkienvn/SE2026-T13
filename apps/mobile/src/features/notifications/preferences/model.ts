import type {
  NotificationPreferences,
  UpdateNotificationPreferences,
} from '@kanban/shared';
import {
  ApiError,
  invalidResponse,
} from '../../../infrastructure/api/errors.ts';

export const inAppKeys = [
  'cardAssigned',
  'commentMentioned',
  'dueReminder',
  'workspaceInvited',
  'membershipChanged',
  'boardInvited',
] as const satisfies readonly (keyof NotificationPreferences['inApp'])[];
export const emailKeys = [
  'cardAssigned',
  'commentMentioned',
  'dueReminder',
] as const satisfies readonly (keyof NotificationPreferences['email'])[];

function object(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
function exact(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    object(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function booleans<K extends string>(
  value: unknown,
  keys: readonly K[],
): Record<K, boolean> {
  if (
    !exact(value, keys) ||
    !keys.every((key) => typeof value[key] === 'boolean')
  )
    throw invalidResponse(200);
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Record<
    K,
    boolean
  >;
}
/** Full nine-leaf allowlist; no defaulting or coercion at the HTTP boundary. */
export function decodePreferences(value: unknown): NotificationPreferences {
  if (!exact(value, ['inApp', 'email'])) throw invalidResponse(200);
  return {
    inApp: booleans(value.inApp, inAppKeys),
    email: booleans(value.email, emailKeys),
  };
}
export function validatePatch(
  value: unknown,
  emailEnabled: boolean,
): UpdateNotificationPreferences {
  const invalid = () => new ApiError('configuration');
  if (!object(value) || !Object.keys(value).length) throw invalid();
  const result: UpdateNotificationPreferences = {};
  for (const [channel, leaves] of Object.entries(value)) {
    if (
      (channel !== 'inApp' && channel !== 'email') ||
      !object(leaves) ||
      !Object.keys(leaves).length ||
      (channel === 'email' && !emailEnabled)
    )
      throw invalid();
    const allowed: readonly string[] =
      channel === 'inApp' ? inAppKeys : emailKeys;
    if (
      !Object.entries(leaves).every(
        ([key, leaf]) => allowed.includes(key) && typeof leaf === 'boolean',
      )
    )
      throw invalid();
    result[channel] = { ...leaves };
  }
  return result;
}
export function preferencesPatch(
  saved: NotificationPreferences,
  draft: NotificationPreferences,
  emailEnabled: boolean,
): UpdateNotificationPreferences {
  const before = decodePreferences(saved),
    after = decodePreferences(draft);
  const patch: UpdateNotificationPreferences = {};
  for (const key of inAppKeys)
    if (before.inApp[key] !== after.inApp[key])
      patch.inApp = { ...patch.inApp, [key]: after.inApp[key] };
  if (emailEnabled)
    for (const key of emailKeys)
      if (before.email[key] !== after.email[key])
        patch.email = { ...patch.email, [key]: after.email[key] };
  return patch;
}
export const hasPatch = (patch: UpdateNotificationPreferences) =>
  Object.keys(patch).length > 0;
export function applyPatch(
  saved: NotificationPreferences,
  patch: UpdateNotificationPreferences,
): NotificationPreferences {
  return {
    inApp: { ...saved.inApp, ...patch.inApp },
    email: { ...saved.email, ...patch.email },
  };
}
export const equalPreferences = (
  a: NotificationPreferences,
  b: NotificationPreferences,
) => !hasPatch(preferencesPatch(a, b, true));
