import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  beginDraft,
  editDraft,
  receivePreferences,
  cancelDraft,
  reconcileSave,
} from '../../src/features/notifications/preferences/draft.ts';
import { preferencesPatch } from '../../src/features/notifications/preferences/model.ts';
import { defaults } from './preferences-fixtures.ts';

test('editing is a deep draft only and Cancel restores the confirmed snapshot', () => {
  const server = defaults(),
    start = beginDraft(server);
  const edited = editDraft(start, 'inApp', 'cardAssigned', false, false);
  assert.equal(edited.saved.inApp.cardAssigned, true);
  assert.equal(edited.draft.inApp.cardAssigned, false);
  assert.equal(server.inApp.cardAssigned, true);
  assert.deepEqual(cancelDraft(edited), start);
  assert.throws(() => editDraft(start, 'email', 'dueReminder', true, false));
});

test('a delayed save acknowledgement cannot overwrite a newer local draft', () => {
  const submitted = editDraft(
    beginDraft(defaults()),
    'inApp',
    'cardAssigned',
    false,
    true,
  );
  const newer = editDraft(submitted, 'inApp', 'commentMentioned', false, true);
  const acknowledged = defaults();
  acknowledged.inApp.cardAssigned = false;
  const result = reconcileSave(newer, submitted, acknowledged, true);
  assert.equal(result.draft.inApp.cardAssigned, false);
  assert.equal(result.draft.inApp.commentMentioned, false);
  assert.deepEqual(preferencesPatch(result.saved, result.draft, true), {
    inApp: { commentMentioned: false },
  });
});

test('clean refetch adopts all fields while dirty refetch keeps only explicit edits', () => {
  const state = beginDraft(defaults()),
    remote = defaults();
  remote.email.commentMentioned = true;
  remote.inApp.membershipChanged = false;
  assert.deepEqual(receivePreferences(state, remote, true).draft, remote);
  const edited = editDraft(state, 'inApp', 'cardAssigned', false, true);
  const next = receivePreferences(edited, remote, true);
  assert.equal(next.conflict, true);
  assert.equal(next.draft.inApp.cardAssigned, false);
  assert.equal(next.draft.inApp.membershipChanged, false);
  assert.equal(next.draft.email.commentMentioned, true);
  assert.deepEqual(preferencesPatch(next.saved, next.draft, true), {
    inApp: { cardAssigned: false },
  });
  assert.deepEqual(cancelDraft(next).draft, remote);
});

test('unchanged refetch is harmless, and a remote matching the draft clears dirty state', () => {
  const edited = editDraft(
    beginDraft(defaults()),
    'inApp',
    'cardAssigned',
    false,
    true,
  );
  assert.equal(receivePreferences(edited, defaults(), true).conflict, false);
  const confirmed = receivePreferences(edited, edited.draft, true);
  assert.deepEqual(
    preferencesPatch(confirmed.saved, confirmed.draft, true),
    {},
  );
  assert.equal(confirmed.conflict, false);
});
