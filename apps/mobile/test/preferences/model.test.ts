import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePreferences,
  validatePatch,
  regionalPatch,
  receiveDraft,
  beginDraft,
} from '../../src/features/preferences/model.ts';

export const saved = {
  theme: 'system',
  timeZone: 'UTC',
  dateFormat: 'YYYY-MM-DD',
  weekStartsOn: 'monday',
} as const;
test('preferences require all four server fields, named zones and exact enums', () => {
  assert.deepEqual(decodePreferences(saved), saved);
  for (const value of [
    {},
    null,
    { ...saved, theme: undefined },
    { ...saved, timeZone: '+07:00' },
    { ...saved, timeZone: 'GMT+7' },
    { ...saved, timeZone: 'Mars/Base' },
    { ...saved, dateFormat: 'short' },
    { ...saved, weekStartsOn: 0 },
  ])
    assert.throws(() => decodePreferences(value));
});
test('PATCH is nonempty, sparse, strict and never fills omitted leaves', () => {
  assert.deepEqual(validatePatch({ theme: 'dark' }), { theme: 'dark' });
  for (const value of [
    {},
    null,
    { language: 'en' },
    { theme: null },
    { timeZone: '' },
  ])
    assert.throws(() => validatePatch(value));
  assert.deepEqual(
    regionalPatch(saved, {
      ...saved,
      theme: 'dark',
      timeZone: 'Asia/Ho_Chi_Minh',
    }),
    { timeZone: 'Asia/Ho_Chi_Minh' },
  );
});
test('refetch preserves touched regional fields and detects only touched conflicts', () => {
  const draft = {
    ...beginDraft(saved),
    draft: { ...saved, timeZone: 'America/New_York' },
  };
  const theme = receiveDraft(draft, { ...saved, theme: 'dark' });
  assert.equal(theme.conflict, false);
  assert.equal(theme.draft.theme, 'dark');
  assert.equal(theme.draft.timeZone, 'America/New_York');
  const changed = receiveDraft(theme, {
    ...saved,
    theme: 'dark',
    timeZone: 'Europe/Paris',
  });
  assert.equal(changed.conflict, true);
  assert.equal(changed.saved.timeZone, 'Europe/Paris');
  assert.equal(changed.draft.timeZone, 'America/New_York');
});
