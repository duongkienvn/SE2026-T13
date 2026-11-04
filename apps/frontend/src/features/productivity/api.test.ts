import { describe, expect, it, vi } from 'vitest';
import { readMyTasks } from './api';

describe('readMyTasks', () => {
  it('retains the actual wire envelope and encodes offset timestamps', async () => {
    const body = {
      success: true,
      statusCode: 200,
      message: 'OK',
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      groupCounts: { OVERDUE: 0, NEXT_7_DAYS: 0, LATER: 0, NO_DUE_DATE: 0 },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body)));
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    await expect(
      readMyTasks('token', { dueFrom: '2026-03-08T00:00:00+07:00' }, signal),
    ).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0][0]).toContain(
      'dueFrom=2026-03-08T00%3A00%3A00%2B07%3A00',
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      signal,
      headers: { Authorization: 'Bearer token' },
    });
  });

  it('rejects an envelope missing group counts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: [],
            meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
          }),
        ),
      ),
    );
    await expect(
      readMyTasks('token', {}, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
