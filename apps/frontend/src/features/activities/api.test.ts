import { describe, expect, it, vi } from 'vitest';
import { ClientErrorCode } from '../../lib/api-client';
import { makeActivity, okPage } from '../../test/board-fixtures';
import { fail, mockApi, ok } from '../../test/mock-api';
import { listActivities } from './api';

const board = 'board';
const path = `/boards/${board}/activities`;

describe('activities REST adapter', () => {
  it('unwraps a paginated list, using the authorized path and page size', async () => {
    const item = makeActivity({
      actionType: 'ROLE_CHANGED',
      entityType: 'MEMBER',
      metadata: { fromRole: 'MEMBER', toRole: 'OWNER' },
    });
    const calls = mockApi({
      [`GET ${path}?page=2&limit=8`]: okPage([item], {
        page: 2,
        limit: 8,
        total: 9,
      }),
    });
    expect(await listActivities('secret', board, 2)).toEqual({
      items: [item],
      meta: { page: 2, limit: 8, total: 9, totalPages: 2 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].headers.Authorization).toBe('Bearer secret');
  });

  it('encodes the board id into the path', async () => {
    const calls = mockApi({
      'GET /boards/a%2Fb/activities?page=1&limit=8': okPage([]),
    });
    await listActivities('secret', 'a/b', 1);
    expect(calls[0].path).toBe('/boards/a%2Fb/activities?page=1&limit=8');
  });

  it('rejects a response without pagination meta', async () => {
    mockApi({ [`GET ${path}?page=1&limit=8`]: ok([makeActivity()]) });
    await expect(listActivities('secret', board, 1)).rejects.toMatchObject({
      code: ClientErrorCode.INVALID_RESPONSE,
    });
  });

  it.each([401, 403, 404])('preserves API error %i', async (status) => {
    mockApi({ [`GET ${path}?page=1&limit=8`]: fail(status, 'ERROR') });
    await expect(listActivities('secret', board, 1)).rejects.toMatchObject({
      status,
      code: 'ERROR',
    });
  });

  it('maps network failure to the client error convention', async () => {
    mockApi({});
    await expect(listActivities('secret', board, 1)).rejects.toMatchObject({
      status: 0,
      code: ClientErrorCode.NETWORK_ERROR,
    });
  });

  it('passes the abort signal through', async () => {
    mockApi({ [`GET ${path}?page=1&limit=8`]: okPage([]) });
    const controller = new AbortController();
    await listActivities('secret', board, 1, controller.signal);
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBe(controller.signal);
  });
});
