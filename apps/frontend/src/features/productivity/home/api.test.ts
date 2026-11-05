import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomeDashboard } from '@kanban/shared';
import { isInternalPath, parseHomeDashboard, readHomeDashboard } from './api';

const home: HomeDashboard = {
  summary: {
    assignedActiveCount: 0,
    overdueCount: 0,
    dueNext7DaysCount: 0,
    workspaceCount: 1,
  },
  upNext: [],
  starredBoards: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      workspaceId: '33333333-3333-4333-8333-333333333333',
      name: 'Delivery',
      backgroundPreset: 'blue',
      isStarred: true,
      lastViewedAt: null,
      path: '/boards/22222222-2222-4222-8222-222222222222',
    },
  ],
  recentBoards: [],
};

afterEach(() => vi.unstubAllGlobals());

describe('readHomeDashboard', () => {
  it('reads the P4-01 envelope with the session token and signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          statusCode: 200,
          message: 'OK',
          data: home,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    await expect(readHomeDashboard('token', signal)).resolves.toEqual(home);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/users\/me\/home$/);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      signal,
      headers: { Authorization: 'Bearer token' },
    });
  });
});

describe('parseHomeDashboard', () => {
  it.each([
    ['missing summary', { ...home, summary: undefined }],
    [
      'negative count',
      { ...home, summary: { ...home.summary, overdueCount: -1 } },
    ],
    [
      'fractional count',
      { ...home, summary: { ...home.summary, workspaceCount: 1.5 } },
    ],
    ['missing list', { ...home, recentBoards: undefined }],
    [
      'external Board path',
      {
        ...home,
        starredBoards: [
          { ...home.starredBoards[0], path: 'https://evil.test/boards' },
        ],
      },
    ],
  ])('rejects %s', (_name, value) => {
    expect(() => parseHomeDashboard(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_RESPONSE' }),
    );
  });

  it('accepts only internal relative routes', () => {
    expect(isInternalPath('/boards/1/cards/2')).toBe(true);
    for (const path of ['//evil.test', 'boards/1', 'https://x', '/a\\b', 7])
      expect(isInternalPath(path)).toBe(false);
  });
});
