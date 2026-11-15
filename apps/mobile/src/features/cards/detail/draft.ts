import { cardTitle } from '../api.ts';

export type CardTextField = 'title' | 'description';
export type CardTextDraft = {
  field: CardTextField;
  baseline: string | null;
  value: string;
};

export function normalizeDescription(value: string): string | null {
  return value.trim() || null;
}

export function draftValue(draft: CardTextDraft): string | null {
  if (draft.field === 'title') return cardTitle(draft.value);
  const value = normalizeDescription(draft.value);
  if (value && [...value].length > 2000)
    throw new Error('Description must be at most 2,000 characters.');
  return value;
}

export function isDraftDirty(draft: CardTextDraft | null): boolean {
  if (!draft) return false;
  try {
    const baseline =
      draft.field === 'description'
        ? normalizeDescription(draft.baseline ?? '')
        : draft.baseline?.trim();
    return draftValue(draft) !== baseline;
  } catch {
    return true;
  }
}

export function hasDraftConflict(
  draft: CardTextDraft | null,
  remote: string | null,
) {
  return !!draft && draft.baseline !== remote;
}
