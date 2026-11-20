import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodePreferences,
  preferencesPatch,
  validatePatch,
} from '../../src/features/notifications/preferences/model.ts';

export const defaults = () => ({
  inApp: {
    cardAssigned: true,
    commentMentioned: true,
    workspaceInvited: true,
    boardInvited: true,
    membershipChanged: true,
    dueReminder: true,
  },
  email: { cardAssigned: false, commentMentioned: false, dueReminder: false },
});

test('decoder preserves all nine server booleans and deep copies them', () => {
  const source = defaults();
  const result = decodePreferences(source);
  assert.deepEqual(result, source);
  result.inApp.cardAssigned = false;
  assert.equal(source.inApp.cardAssigned, true);
  const enabled = defaults();
  enabled.email.dueReminder = true;
  assert.equal(decodePreferences(enabled).email.dueReminder, true);
});

test('decoder fails closed on missing, unknown and nonboolean fields without coercion', () => {
  for (const value of [
    null,
    [],
    {},
    { ...defaults(), push: {} },
    { ...defaults(), email: null },
    { ...defaults(), email: { ...defaults().email, extra: true } },
    { ...defaults(), inApp: { ...defaults().inApp, cardAssigned: 'false' } },
    { ...defaults(), email: { cardAssigned: false, commentMentioned: false } },
    { ...defaults(), email: { ...defaults().email, dueReminder: 0 } },
  ]) {
    assert.throws(() => decodePreferences(value));
  }
});

test('diff emits only changed known leaves, supports both groups and gates email', () => {
  const saved = defaults(),
    draft = defaults();
  assert.deepEqual(preferencesPatch(saved, draft, true), {});
  draft.inApp.cardAssigned = false;
  assert.deepEqual(preferencesPatch(saved, draft, true), {
    inApp: { cardAssigned: false },
  });
  draft.email.dueReminder = true;
  assert.deepEqual(preferencesPatch(saved, draft, true), {
    inApp: { cardAssigned: false },
    email: { dueReminder: true },
  });
  assert.deepEqual(preferencesPatch(saved, draft, false), {
    inApp: { cardAssigned: false },
  });
  assert.equal(saved.inApp.cardAssigned, true);
  for (const key of Object.keys(draft.inApp) as (keyof typeof draft.inApp)[])
    draft.inApp[key] = false;
  for (const key of Object.keys(draft.email) as (keyof typeof draft.email)[])
    draft.email[key] = true;
  assert.deepEqual(preferencesPatch(saved, draft, true), draft);
});

test('write validation rejects empty, null, extra and coerced leaves and disabled email', () => {
  assert.deepEqual(validatePatch({ inApp: { boardInvited: false } }, false), {
    inApp: { boardInvited: false },
  });
  for (const input of [
    null,
    {},
    [],
    { inApp: {} },
    { email: null },
    { push: true },
    { inApp: { unknown: false } },
    { email: { dueReminder: 'true' } },
    { email: { dueReminder: null } },
  ])
    assert.throws(() => validatePatch(input, true));
  assert.throws(() => validatePatch({ email: { dueReminder: true } }, false));
  assert.throws(() =>
    preferencesPatch(
      defaults(),
      { ...defaults(), extra: true } as ReturnType<typeof defaults>,
      true,
    ),
  );
});
