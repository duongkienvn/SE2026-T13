import { useQueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../../app/AppProviders';
import { makeActivity, okPage } from '../../test/board-fixtures';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockRequest,
} from '../../test/mock-api';
import { useAuth } from '../auth/useAuth';
import { boardKeys } from '../boards/query-keys';
import { useActivities } from './hooks';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppProviders>{children}</AppProviders>
);

const pagePath = (board: string, page: number) =>
  `/boards/${board}/activities?page=${page}&limit=8`;

function activityCalls(calls: MockRequest[]) {
  return calls.filter((call) => call.path.includes('/activities'));
}

describe('useActivities', () => {
  it('does not fetch while disabled, then fetches with the bearer token', async () => {
    storeSession('activity-token');
    const item = makeActivity();
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${pagePath('b1', 1)}`]: okPage([item], { limit: 8 }),
    });

    const { result, rerender } = renderHook(
      ({ enabled }) => ({
        query: useActivities('b1', 1, { enabled }),
        auth: useAuth(),
      }),
      { wrapper, initialProps: { enabled: false } },
    );
    await waitFor(() => expect(result.current.auth.user).toBeDefined());
    // Give an (incorrectly) enabled query time to start before asserting.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(activityCalls(calls)).toHaveLength(0);
    expect(result.current.query.fetchStatus).toBe('idle');

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.query.data?.items).toEqual([item]);
    expect(activityCalls(calls)[0].headers.Authorization).toBe(
      'Bearer activity-token',
    );
  });

  it('keeps boards and pages in separate cache entries', async () => {
    storeSession();
    const a1 = makeActivity({ boardId: 'b1' });
    const a2 = makeActivity({ boardId: 'b1' });
    const other = makeActivity({ boardId: 'b2' });
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${pagePath('b1', 1)}`]: okPage([a1], { limit: 8, total: 9 }),
      [`GET ${pagePath('b1', 2)}`]: okPage([a2], {
        page: 2,
        limit: 8,
        total: 9,
      }),
      [`GET ${pagePath('b2', 1)}`]: okPage([other], { limit: 8 }),
    });

    const { result } = renderHook(
      () => ({
        first: useActivities('b1', 1),
        second: useActivities('b1', 2),
        otherBoard: useActivities('b2', 1),
      }),
      { wrapper },
    );
    await waitFor(() =>
      expect(
        Object.values(result.current).every((query) => query.isSuccess),
      ).toBe(true),
    );
    expect(result.current.first.data?.items).toEqual([a1]);
    expect(result.current.second.data?.items).toEqual([a2]);
    expect(result.current.otherBoard.data?.items).toEqual([other]);
    expect(activityCalls(calls)).toHaveLength(3);
  });

  it('does not retry when access is lost', async () => {
    storeSession();
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${pagePath('b1', 1)}`]: fail(404, 'NOT_FOUND'),
    });

    const { result } = renderHook(() => useActivities('b1', 1), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 404 });
    expect(activityCalls(calls)).toHaveLength(1);
  });

  it('refetches when the board detail prefix is invalidated (realtime resync)', async () => {
    storeSession();
    let served = 0;
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${pagePath('b1', 1)}`]: () => {
        served += 1;
        return okPage([makeActivity()], { limit: 8 });
      },
    });

    const { result } = renderHook(
      () => ({ query: useActivities('b1', 1), client: useQueryClient() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(served).toBe(1);

    await act(() =>
      result.current.client.invalidateQueries({
        queryKey: boardKeys.detail('b1'),
      }),
    );
    expect(served).toBe(2);
  });
});
