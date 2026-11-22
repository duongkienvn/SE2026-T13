import { invalidResponse } from '../../infrastructure/api/errors.ts';

export const themes = ['light', 'dark', 'system'] as const;
export const dateFormats = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const;
export const weekStarts = ['monday', 'sunday'] as const;
export type Preferences = {
  theme: (typeof themes)[number];
  timeZone: string;
  dateFormat: (typeof dateFormats)[number];
  weekStartsOn: (typeof weekStarts)[number];
};
export type Patch = Partial<Preferences>;
export const regionalKeys = ['timeZone', 'dateFormat', 'weekStartsOn'] as const;
const keys = ['theme', ...regionalKeys] as const;
export function validZone(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > 100 ||
    !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(value)
  )
    return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
function validField(key: keyof Preferences, value: unknown) {
  if (key === 'timeZone') return validZone(value);
  const choices: readonly unknown[] =
    key === 'theme' ? themes : key === 'dateFormat' ? dateFormats : weekStarts;
  return choices.includes(value);
}
export function decodePreferences(value: unknown): Preferences {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !keys.every(
      (key) =>
        Object.hasOwn(value, key) &&
        validField(key, (value as Preferences)[key]),
    )
  )
    throw invalidResponse(200);
  const result = value as Preferences;
  return {
    theme: result.theme,
    timeZone: result.timeZone,
    dateFormat: result.dateFormat,
    weekStartsOn: result.weekStartsOn,
  };
}
export function validatePatch(value: unknown): Patch {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid preferences.');
  const entries = Object.entries(value);
  if (
    !entries.length ||
    !entries.every(
      ([key, v]) =>
        keys.includes(key as keyof Preferences) &&
        validField(key as keyof Preferences, v),
    )
  )
    throw new Error('Invalid preferences.');
  return { ...value };
}
export function regionalPatch(saved: Preferences, draft: Preferences): Patch {
  const patch: Patch = {};
  for (const key of regionalKeys)
    if (saved[key] !== draft[key]) Object.assign(patch, { [key]: draft[key] });
  return patch;
}
export type RegionalDraft = {
  saved: Preferences;
  draft: Preferences;
  conflict: boolean;
};
export const beginDraft = (saved: Preferences): RegionalDraft => ({
  saved,
  draft: { ...saved },
  conflict: false,
});
export function receiveDraft(
  form: RegionalDraft,
  saved: Preferences,
): RegionalDraft {
  const touched = regionalPatch(form.saved, form.draft);
  const draft = { ...saved, ...touched };
  const conflict =
    form.conflict ||
    regionalKeys.some(
      (key) =>
        key in touched &&
        form.saved[key] !== saved[key] &&
        form.draft[key] !== saved[key],
    );
  return { saved, draft, conflict };
}
