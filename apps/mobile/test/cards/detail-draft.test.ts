import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  draftValue,
  hasDraftConflict,
  isDraftDirty,
  normalizeDescription,
  type CardTextDraft,
} from '../../src/features/cards/detail/draft.ts';
import { createCardApi } from '../../src/features/cards/api.ts';
import { decodeCard } from '../../src/features/cards/decoder.ts';
import { BOARD, integration, json } from '../realtime/integration-support.ts';
import { cardDto, timestamp } from '../workspaces/kanban-fixtures.ts';
import { uuid } from '../workspaces/fixtures.ts';

test('description normalization, null clear, exact baseline and Unicode limits', () => {
  assert.equal(normalizeDescription(' \n '), null);
  assert.equal(normalizeDescription('  a\nb  '), 'a\nb');
  const draft: CardTextDraft = {
    field: 'description',
    baseline: 'hello',
    value: ' hello  ',
  };
  assert.equal(isDraftDirty(draft), false);
  assert.equal(hasDraftConflict(draft, 'hello'), false);
  assert.equal(hasDraftConflict(draft, 'remote'), true);
  assert.equal(draftValue({ ...draft, value: ' ' }), null);
  assert.equal(
    draftValue({ ...draft, value: '😀'.repeat(2000) })?.length,
    4000,
  );
  assert.throws(
    () => draftValue({ ...draft, value: 'a'.repeat(2001) }),
    /2,000/,
  );
  assert.equal(isDraftDirty({ ...draft, value: 'a'.repeat(2001) }), true);
  assert.equal(isDraftDirty(null), false);
});

test('title validation and unrelated updates do not create description conflict', () => {
  const draft: CardTextDraft = {
    field: 'title',
    baseline: 'Old',
    value: ' New ',
  };
  assert.equal(draftValue(draft), 'New');
  assert.throws(() => draftValue({ ...draft, value: ' ' }), /title/);
  assert.throws(() => draftValue({ ...draft, value: 'x'.repeat(121) }), /120/);
  const description: CardTextDraft = {
    field: 'description',
    baseline: null,
    value: 'notes',
  };
  const remote = {
    ...cardDto(1),
    title: 'Other title',
    description: null,
    updatedAt: timestamp,
  };
  assert.equal(hasDraftConflict(description, remote.description), false);
  assert.equal(isDraftDirty(description), true);
});

test('Card decoder rejects wrong Board, malformed assignees/dates, and preserves archived safe plain text', () => {
  const card = {
    ...cardDto(1),
    boardId: BOARD,
    description: '<script>alert(1)</script>\nhttps://example.test',
  };
  assert.equal(decodeCard(card, BOARD).description, card.description);
  assert.throws(() => decodeCard(card, uuid(989)));
  assert.throws(() =>
    decodeCard({ ...card, assignees: [{ userId: uuid(2) }] }, BOARD),
  );
  assert.throws(() => decodeCard({ ...card, startDate: 'tomorrow' }, BOARD));
  assert.throws(() => decodeCard({ ...card, archivedAt: timestamp }, BOARD));
  assert.equal(
    decodeCard({ ...card, isArchived: true, archivedAt: timestamp }, BOARD)
      .isArchived,
    true,
  );
});

test('description PATCH contains only description, sends explicit null, never undefined, and validates returned Card ID', async () => {
  const env = await integration();
  try {
    const card = { ...cardDto(1), boardId: BOARD };
    const bodies: unknown[] = [];
    env.respond((_url, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return Promise.resolve(
        json({
          success: true,
          statusCode: 200,
          message: 'OK',
          data: { ...card, ...JSON.parse(String(init.body)) },
        }),
      );
    });
    const api = createCardApi(env.data.api, env.identity, BOARD);
    await api.update(
      card.id,
      { description: 'Text\n<script>literal</script>' },
      new AbortController().signal,
    );
    await api.update(
      card.id,
      { description: null },
      new AbortController().signal,
    );
    assert.deepEqual(bodies, [
      { description: 'Text\n<script>literal</script>' },
      { description: null },
    ]);
    await assert.rejects(async () =>
      api.update(
        card.id,
        { description: undefined },
        new AbortController().signal,
      ),
    );
    env.respond(() =>
      Promise.resolve(
        json({
          success: true,
          statusCode: 200,
          message: 'OK',
          data: { ...card, id: uuid(99) },
        }),
      ),
    );
    await assert.rejects(api.getCard(card.id, new AbortController().signal));
  } finally {
    env.dispose();
  }
});
