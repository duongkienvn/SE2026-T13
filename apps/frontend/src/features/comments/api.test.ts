import { describe, expect, it } from 'vitest';
import { ClientErrorCode } from '../../lib/api-client';
import { okPage } from '../../test/board-fixtures';
import { fail, mockApi, ok } from '../../test/mock-api';
import {
  createComment,
  deleteComment,
  listComments,
  updateComment,
} from './api';
import type { Comment } from './types';

const board = 'board';
const card = 'card';
const path = `/boards/${board}/cards/${card}/comments`;
const item: Comment = {
  id: 'comment',
  cardId: card,
  authorId: 'author',
  content: 'Xin chào\n✅',
  createdAt: '2026-10-16T00:00:00Z',
  updatedAt: '2026-10-16T00:00:00Z',
};

describe('comments REST adapter', () => {
  it('unwraps a paginated list, using the authorized path and page size', async () => {
    const calls = mockApi({
      [`GET ${path}?page=2&limit=20`]: okPage([item], {
        page: 2,
        limit: 20,
        total: 21,
      }),
    });
    expect(await listComments('secret', board, card, 2)).toEqual({
      items: [item],
      meta: { page: 2, limit: 20, total: 21, totalPages: 2 },
    });
    expect(calls[0].headers.Authorization).toBe('Bearer secret');
    expect(calls[0].path).toBe(`${path}?page=2&limit=20`);
  });

  it('sends only trimmed content for create/edit, and handles empty 204 delete', async () => {
    const calls = mockApi({
      [`POST ${path}`]: ok(item, 201),
      [`PATCH ${path}/${item.id}`]: ok(item),
      [`DELETE ${path}/${item.id}`]: { status: 204 },
    });
    expect(
      await createComment('secret', board, card, {
        content: '  Xin chào\n✅  ',
      }),
    ).toEqual(item);
    expect(
      await updateComment('secret', board, card, item.id, {
        content: '  Xin chào\n✅ ',
      }),
    ).toEqual(item);
    expect(await deleteComment('secret', board, card, item.id)).toBeUndefined();
    expect(calls.map((call) => [call.method, call.body])).toEqual([
      ['POST', { content: 'Xin chào\n✅' }],
      ['PATCH', { content: 'Xin chào\n✅' }],
      ['DELETE', undefined],
    ]);
    expect(
      calls.every((call) => call.headers.Authorization === 'Bearer secret'),
    ).toBe(true);
  });

  it.each([400, 401, 403, 404, 409])(
    'preserves API error %i',
    async (status) => {
      mockApi({ [`POST ${path}`]: fail(status, 'ERROR') });
      await expect(
        createComment('secret', board, card, { content: 'x' }),
      ).rejects.toMatchObject({ status, code: 'ERROR' });
    },
  );

  it('maps network failure to the client error convention', async () => {
    mockApi({});
    await expect(listComments('secret', board, card, 1)).rejects.toEqual(
      expect.objectContaining({
        status: 0,
        code: ClientErrorCode.NETWORK_ERROR,
      }),
    );
  });
});
