import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeMention,
  changeText,
  contentError,
  emptyDraft,
  finalizeDraft,
  insertMention,
  splitsPair,
  validSpans,
} from '../../src/features/cards/comments/mentions.ts';
import { uuid } from '../workspaces/fixtures.ts';
const a = { userId: uuid(1), displayName: 'An 😀', page: 1 };
const b = { userId: uuid(2), displayName: 'An 😀', page: 6 };
const names = new Map([
  [a.userId, a.displayName],
  [b.userId, b.displayName],
]);
const insert = (text: string, member = a) =>
  insertMention(
    { text, spans: [] },
    { start: text.length, end: text.length },
    member,
  )!;

test('UTF-16 mentions preserve selected identity through emoji, duplicate names, multiline and trim', () => {
  const first = insert('  😀\n@An');
  assert.equal(first.draft.spans[0].start, 5);
  assert.equal(first.draft.spans[0].end, 11);
  const typed = changeText(first.draft, first.draft.text + '\n🚀 @');
  const second = insertMention(
    typed,
    { start: typed.text.length, end: typed.text.length },
    b,
  )!;
  const payload = finalizeDraft(second.draft, names);
  assert.equal(payload.content, '😀\n@An 😀 \n🚀 @An 😀');
  assert.equal(payload.mentions[0].start, 3);
  assert.equal(payload.mentions[1].userId, b.userId);
  for (const span of payload.mentions)
    assert.equal(payload.content.slice(span.start, span.end), '@An 😀');
  assert.deepEqual(
    finalizeDraft({ text: '@An 😀', spans: [] }, names).mentions,
    [],
  );
});

test('typing, insert/delete/replace/paste/autocorrect and ambiguous repeated text only preserve intact spans', () => {
  const draft = insert('Hi @').draft;
  const prefixed = changeText(draft, '🚀 ' + draft.text);
  assert.equal(prefixed.spans[0].start, draft.spans[0].start + 3);
  assert.deepEqual(changeText(prefixed, draft.text), draft);
  assert.deepEqual(
    changeText(draft, draft.text.replace('An', 'Anh')).spans,
    [],
  );
  assert.deepEqual(changeText(draft, draft.text.replace('😀', '🙂')).spans, []);
  assert.deepEqual(
    changeText(draft, 'pasted ' + draft.text + ' tail').spans,
    [],
  );
  assert.deepEqual(changeText(draft, '').spans, []);
  const cursor = { start: 3, end: 3 };
  assert.equal(activeMention(draft, cursor), undefined);
  assert.equal(
    activeMention({ text: 'a@b.test', spans: [] }, { start: 3, end: 3 }),
    undefined,
  );
  assert.equal(
    activeMention({ text: '@A', spans: [] }, { start: 0, end: 2 }),
    undefined,
  );
  assert.equal(
    activeMention({ text: '@A\nB', spans: [] }, { start: 4, end: 4 }),
    undefined,
  );
  const ambiguous = {
    text: '@A @A',
    spans: [{ userId: a.userId, start: 0, end: 2 }],
  };
  assert.deepEqual(changeText(ambiguous, '@A @A @A').spans, []);
});

test('cursor selection inserts in the middle, shifts later chosen spans and does not split surrogates', () => {
  const initial = insert('end @').draft;
  const edited = changeText(initial, '@x ' + initial.text);
  const value = insertMention(edited, { start: 2, end: 2 }, b)!;
  assert.equal(value.draft.spans[0].userId, b.userId);
  assert.equal(value.draft.spans[1].userId, a.userId);
  assert.equal(validSpans(value.draft.text, value.draft.spans), true);
  assert.equal(splitsPair('😀', 1), true);
  assert.equal(
    activeMention({ text: '@😀', spans: [] }, { start: 2, end: 2 }),
    undefined,
  );
});

test('final validation rejects stale names, unavailable targets, malformed UUIDs, overlaps, trim loss and limits', () => {
  const draft = insert('@').draft;
  assert.throws(() => finalizeDraft(draft, new Map([[a.userId, 'Changed']])));
  assert.throws(() => finalizeDraft(draft, new Map()));
  for (const spans of [
    [{ userId: 'bad', start: 0, end: 6 }],
    [{ userId: a.userId, start: -1, end: 6 }],
    [{ userId: a.userId, start: 0, end: 5 }], // splits the emoji
    [{ userId: a.userId, start: 0, end: 99 }],
    [
      { userId: a.userId, start: 0, end: 6 },
      { userId: b.userId, start: 0, end: 6 },
    ],
  ])
    assert.equal(validSpans(draft.text, spans), false);
  const trailingName = { ...a, displayName: 'An ' };
  assert.throws(() =>
    finalizeDraft(
      insert('@', trailingName).draft,
      new Map([[a.userId, 'An ']]),
    ),
  );
  let many = emptyDraft();
  for (let i = 0; i < 21; i++) {
    many = changeText(many, many.text + '@');
    many = insertMention(
      many,
      { start: many.text.length, end: many.text.length },
      a,
    )!.draft;
  }
  assert.throws(() => finalizeDraft(many, names));
  assert.doesNotThrow(() =>
    finalizeDraft({ text: many.text, spans: many.spans.slice(0, 20) }, names),
  );
  const eleven = Array.from({ length: 11 }, (_, i) => ({
    userId: uuid(i + 1),
    start: i * 3,
    end: i * 3 + 2,
  }));
  assert.equal(validSpans('@A '.repeat(11), eleven), false);
  assert.equal(contentError('😀'.repeat(2000)), undefined);
  assert.ok(contentError('😀'.repeat(2001)));
  assert.ok(contentError(' \n '));
});
