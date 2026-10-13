import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../../app/AppProviders';
import { ApiError } from '../../lib/api-client';
import { retryUnlessClientError } from '../../lib/query-client';
import { makeBoard, okPage } from '../../test/board-fixtures';
import { fail, mockApi, ok, storeSession, testUser } from '../../test/mock-api';
import { useAddMember, useBoardMembers } from '../board-members/hooks';
import { useArchiveBoard, useBoard, useBoards, useCreateBoard } from './hooks';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppProviders>{children}</AppProviders>
);

const PAGE_1 = 'GET /boards?page=1&limit=100';
const PAGE_2 = 'GET /boards?page=2&limit=100';

describe('board hooks', () => {
  it('loads every page of boards with the bearer token', async () => {
    storeSession('board-token');
    const first = makeBoard({ name: 'First' });
    const second = makeBoard({ name: 'Second' });
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [PAGE_1]: okPage([first], { page: 1, limit: 100, total: 101 }),
      [PAGE_2]: okPage([second], { page: 2, limit: 100, total: 101 }),
    });

    const { result } = renderHook(() => useBoards(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([first, second]);
    const listCalls = calls.filter((c) => c.path.startsWith('/boards'));
    expect(listCalls.map((c) => c.path)).toEqual([
      '/boards?page=1&limit=100',
      '/boards?page=2&limit=100',
    ]);
    expect(listCalls[0].headers).toMatchObject({
      Authorization: 'Bearer board-token',
    });
  });

  it('refreshes the board list after creating a board', async () => {
    storeSession();
    const created = makeBoard({ name: 'New board' });
    let listCalls = 0;
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [PAGE_1]: () => {
        listCalls += 1;
        return okPage(listCalls === 1 ? [] : [created]);
      },
      'POST /boards': ok(created, 201),
    });

    const { result } = renderHook(
      () => ({ boards: useBoards(), create: useCreateBoard() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.boards.isSuccess).toBe(true));

    await act(() =>
      result.current.create.mutateAsync({
        name: 'New board',
        description: null,
      }),
    );

    await waitFor(() => expect(listCalls).toBe(2));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'New board',
      description: null,
    });
    await waitFor(() => expect(result.current.boards.data).toEqual([created]));
  });

  it('archives a board and refreshes the list', async () => {
    storeSession();
    const board = makeBoard();
    let listCalls = 0;
    mockApi({
      'GET /users/me': ok(testUser),
      [PAGE_1]: () => {
        listCalls += 1;
        return okPage(listCalls === 1 ? [board] : []);
      },
      [`POST /boards/${board.id}/archive`]: ok({ ...board, isArchived: true }),
    });

    const { result } = renderHook(
      () => ({ boards: useBoards(), archive: useArchiveBoard(board.id) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.boards.isSuccess).toBe(true));
    await act(() => result.current.archive.mutateAsync());

    await waitFor(() => expect(result.current.boards.data).toEqual([]));
  });

  it('refreshes members and the board after adding a member', async () => {
    storeSession();
    const board = makeBoard();
    let memberCalls = 0;
    let boardCalls = 0;
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: () => {
        boardCalls += 1;
        return ok(board);
      },
      [`GET /boards/${board.id}/members`]: () => {
        memberCalls += 1;
        return ok([]);
      },
      [`POST /boards/${board.id}/members`]: ok({}, 201),
    });

    const { result } = renderHook(
      () => ({
        board: useBoard(board.id),
        members: useBoardMembers(board.id),
        add: useAddMember(board.id),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.members.isSuccess).toBe(true));

    await act(() =>
      result.current.add.mutateAsync({ email: 'grace@example.com' }),
    );

    await waitFor(() => expect(memberCalls).toBe(2));
    expect(boardCalls).toBe(2);
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      email: 'grace@example.com',
    });
  });

  it('ends the session when a board request is unauthorized', async () => {
    storeSession();
    const board = makeBoard();
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: fail(401, 'UNAUTHORIZED'),
    });

    const { result } = renderHook(() => useBoard(board.id), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
  });

  it('rejects list responses without pagination meta', async () => {
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      [PAGE_1]: ok([makeBoard()]),
    });

    const { result } = renderHook(() => useBoards(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 5000,
    });
    expect(result.current.error).toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('retryUnlessClientError', () => {
  it('never retries 4xx errors', () => {
    for (const status of [401, 403, 404, 409]) {
      expect(retryUnlessClientError(0, new ApiError(status, 'X', 'x'))).toBe(
        false,
      );
    }
  });

  it('retries server and network errors at most twice', () => {
    const error = new ApiError(500, 'INTERNAL_ERROR', 'x');
    expect(retryUnlessClientError(0, error)).toBe(true);
    expect(retryUnlessClientError(1, error)).toBe(true);
    expect(retryUnlessClientError(2, error)).toBe(false);
  });
});
