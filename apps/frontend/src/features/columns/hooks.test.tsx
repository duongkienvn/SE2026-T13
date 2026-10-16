import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../../app/AppProviders';
import { makeBoard, makeColumn, okPage } from '../../test/board-fixtures';
import { fail, mockApi, ok, storeSession, testUser } from '../../test/mock-api';
import { useBoard } from '../boards/hooks';
import {
  useColumns,
  useCreateColumn,
  useDeleteColumn,
  useMoveColumn,
  useRenameColumn,
} from './hooks';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppProviders>{children}</AppProviders>
);

const BOARD = '00000000-0000-4000-9000-000000000000';
const COLUMNS = `/boards/${BOARD}/columns`;
const page = (path: string, n: number) => `GET ${path}?page=${n}&limit=100`;

describe('column hooks', () => {
  it('loads every page of columns with the bearer token', async () => {
    storeSession('column-token');
    const first = makeColumn();
    const second = makeColumn();
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [page(COLUMNS, 1)]: okPage([first], { page: 1, total: 101 }),
      [page(COLUMNS, 2)]: okPage([second], { page: 2, total: 101 }),
    });

    const { result } = renderHook(() => useColumns(BOARD), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([first, second]);
    const listCalls = calls.filter((c) => c.path.startsWith(COLUMNS));
    expect(listCalls).toHaveLength(2);
    expect(listCalls[1].headers).toMatchObject({
      Authorization: 'Bearer column-token',
    });
  });

  it('creates, renames and deletes, refetching the columns each time', async () => {
    storeSession();
    const column = makeColumn({ name: 'To Do' });
    let listCalls = 0;
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [page(COLUMNS, 1)]: () => {
        listCalls += 1;
        return okPage([column]);
      },
      [`POST ${COLUMNS}`]: ok(column, 201),
      [`PATCH ${COLUMNS}/${column.id}`]: ok({ ...column, name: 'Doing' }),
      [`DELETE ${COLUMNS}/${column.id}`]: { status: 204 },
    });

    const { result } = renderHook(
      () => ({
        columns: useColumns(BOARD),
        create: useCreateColumn(BOARD),
        rename: useRenameColumn(BOARD),
        remove: useDeleteColumn(BOARD),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.columns.isSuccess).toBe(true));

    await act(() => result.current.create.mutateAsync({ name: 'To Do' }));
    await waitFor(() => expect(listCalls).toBe(2));
    await act(() =>
      result.current.rename.mutateAsync({ columnId: column.id, name: 'Doing' }),
    );
    await waitFor(() => expect(listCalls).toBe(3));
    await act(() => result.current.remove.mutateAsync(column.id));
    await waitFor(() => expect(listCalls).toBe(4));

    const bodies = calls
      .filter((c) => c.method !== 'GET')
      .map((c) => [c.method, c.body]);
    expect(bodies).toEqual([
      ['POST', { name: 'To Do' }],
      ['PATCH', { name: 'Doing' }],
      ['DELETE', undefined],
    ]);
  });

  it('reports a non-empty column with its server code', async () => {
    storeSession();
    const column = makeColumn();
    mockApi({
      'GET /users/me': ok(testUser),
      [`DELETE ${COLUMNS}/${column.id}`]: fail(409, 'COLUMN_NOT_EMPTY'),
    });

    const { result } = renderHook(() => useDeleteColumn(BOARD), { wrapper });

    await expect(
      act(() => result.current.mutateAsync(column.id)),
    ).rejects.toMatchObject({ status: 409, code: 'COLUMN_NOT_EMPTY' });
  });

  it('refreshes the board when a change hits an archived board', async () => {
    storeSession();
    const board = makeBoard({ id: BOARD });
    let boardCalls = 0;
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${BOARD}`]: () => {
        boardCalls += 1;
        return ok(boardCalls === 1 ? board : { ...board, isArchived: true });
      },
      [`POST ${COLUMNS}`]: fail(409, 'BOARD_ARCHIVED'),
    });

    const { result } = renderHook(
      () => ({ board: useBoard(BOARD), create: useCreateColumn(BOARD) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.board.isSuccess).toBe(true));

    await act(() =>
      result.current.create.mutateAsync({ name: 'x' }).catch(() => undefined),
    );

    await waitFor(() =>
      expect(result.current.board.data?.isArchived).toBe(true),
    );
  });

  it('moves a column and refetches the order, also after a refusal', async () => {
    storeSession();
    const column = makeColumn();
    let listCalls = 0;
    let moveCalls = 0;
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [page(COLUMNS, 1)]: () => {
        listCalls += 1;
        return okPage([column]);
      },
      [`PATCH ${COLUMNS}/${column.id}/move`]: () =>
        ++moveCalls === 1 ? ok(column) : fail(400, 'INVALID_COLUMN_MOVE'),
    });

    const { result } = renderHook(
      () => ({ columns: useColumns(BOARD), move: useMoveColumn(BOARD) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.columns.isSuccess).toBe(true));

    await act(() =>
      result.current.move.mutateAsync({
        columnId: column.id,
        beforeColumnId: null,
      }),
    );
    expect(listCalls).toBe(2);
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      beforeColumnId: null,
    });

    await act(() =>
      result.current.move
        .mutateAsync({ columnId: column.id, beforeColumnId: column.id })
        .catch(() => undefined),
    );
    await waitFor(() => expect(listCalls).toBe(3));
  });
});
