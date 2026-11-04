import type { GlobalSearchResults } from '@kanban/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { globalSearch } from './api';

const response: GlobalSearchResults = {
  query: '😀 %_',
  type: 'all',
  groups: {
    workspaces: { items: [], total: 0, hasMore: false },
    boards: {
      items: [
        {
          type: 'board',
          id: 'b',
          title: 'Board',
          subtitle: null,
          workspaceId: 'w',
          workspaceName: null,
          path: '/boards/b',
        },
      ],
      total: 1,
      hasMore: false,
    },
    cards: { items: [], total: 0, hasMore: false },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('globalSearch', () => {
  it('encodes literal Unicode and omits page for grouped results', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: response })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    await expect(
      globalSearch('token', { q: response.query, type: 'all' }, signal),
    ).resolves.toEqual(response);
    const [url, options] = fetchMock.mock.calls[0];
    const params = new URL(String(url), 'http://localhost').searchParams;
    expect(Object.fromEntries(params)).toEqual({
      q: response.query,
      type: 'all',
      limit: '5',
    });
    expect(options).toMatchObject({
      signal,
      headers: { Authorization: 'Bearer token' },
    });
  });

  it('requests the selected type and page with the per-type limit', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: response })),
      );
    vi.stubGlobal('fetch', fetchMock);
    await globalSearch(
      'token',
      { q: 'work', type: 'cards', page: 2 },
      new AbortController().signal,
    );
    const params = new URL(
      String(fetchMock.mock.calls[0][0]),
      'http://localhost',
    ).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      q: 'work',
      type: 'cards',
      limit: '20',
      page: '2',
    });
  });
});
