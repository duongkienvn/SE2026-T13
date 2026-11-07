import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { boardKeys } from '../boards/query-keys';
import { previewSummaryFilters } from './preview-summary-cache';

it('invalidates only batches containing the card, with a safe malformed-key fallback', async () => {
  const client = new QueryClient();
  const prefix = [...boardKeys.cards('board'), 'preview-summaries'];
  const matching = [...prefix, 'user', 1, ['CARD-A', 'card-b']];
  const unrelated = [...prefix, 'user', 1, ['card-c']];
  const malformed = [...prefix, 'legacy'];
  const otherBoard = [
    ...boardKeys.cards('other'),
    'preview-summaries',
    'user',
    1,
    ['card-a'],
  ];
  for (const key of [matching, unrelated, malformed, otherBoard])
    client.setQueryData(key, []);
  await client.invalidateQueries(previewSummaryFilters('board', 'card-a'));
  expect(client.getQueryState(matching)?.isInvalidated).toBe(true);
  expect(client.getQueryState(malformed)?.isInvalidated).toBe(true);
  expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  expect(client.getQueryState(otherBoard)?.isInvalidated).toBe(false);
});
