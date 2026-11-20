import type { NotificationPreferences } from '@kanban/shared';
import {
  applyPatch,
  decodePreferences,
  equalPreferences,
  hasPatch,
  preferencesPatch,
  validatePatch,
} from './model.ts';

export type PreferencesDraft = {
  saved: NotificationPreferences;
  draft: NotificationPreferences;
  conflict: boolean;
};
export function beginDraft(value: NotificationPreferences): PreferencesDraft {
  return {
    saved: decodePreferences(value),
    draft: decodePreferences(value),
    conflict: false,
  };
}
export const cancelDraft = (state: PreferencesDraft) => beginDraft(state.saved);
export function reconcileSave(
  current: PreferencesDraft | null,
  submitted: PreferencesDraft,
  authoritative: NotificationPreferences,
  emailEnabled: boolean,
): PreferencesDraft {
  if (!current || current === submitted) return beginDraft(authoritative);
  if (equalPreferences(current.saved, submitted.saved)) {
    // The ACK has not been adopted yet. Preserve changes made *since submit*,
    // including a same-switch reversal back to the old saved value.
    const newer = preferencesPatch(
      submitted.draft,
      current.draft,
      emailEnabled,
    );
    return {
      ...beginDraft(authoritative),
      draft: applyPatch(authoritative, newer),
    };
  }
  return receivePreferences(current, authoritative, emailEnabled);
}
export function editDraft(
  state: PreferencesDraft,
  channel: 'inApp' | 'email',
  key: string,
  value: boolean,
  emailEnabled: boolean,
): PreferencesDraft {
  return {
    ...state,
    draft: applyPatch(
      state.draft,
      validatePatch({ [channel]: { [key]: value } }, emailEnabled),
    ),
  };
}
/** Adopt fresh untouched leaves; keep only local intent, never stale whole groups.
 * The UI requires explicit review before saving a rebased conflicting draft.
 */
export function receivePreferences(
  state: PreferencesDraft,
  value: NotificationPreferences,
  emailEnabled: boolean,
): PreferencesDraft {
  const saved = decodePreferences(value);
  const intent = preferencesPatch(state.saved, state.draft, emailEnabled);
  if (!hasPatch(intent)) return beginDraft(saved);
  const draft = applyPatch(saved, intent);
  return {
    saved,
    draft,
    conflict:
      hasPatch(preferencesPatch(saved, draft, emailEnabled)) &&
      (state.conflict || !equalPreferences(state.saved, saved)),
  };
}
