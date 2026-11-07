import { act, renderHook, waitFor } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../../app/AppProviders';
import { makeCard, okPage } from '../../test/board-fixtures';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../test/mock-api';
import {
  useArchiveCard,
  useAssignCard,
  useCard,
  useCards,
  useCreateCard,
  useMoveCard,
  useUnassignCard,
  useUpdateCard,
} from './hooks';
import { useColumns } from '../columns/hooks';
import {
  useAllFilteredCards,
  useFilteredCards,
  usePreviewSummaries,
} from './board-filter';
import { previewSummaryFilters } from './preview-summary-cache';
import { createInvalidationQueue } from '../realtime/invalidation-queue';
import { boardKeys } from '../boards/query-keys';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppProviders>{children}</AppProviders>
);

const BOARD = '00000000-0000-4000-9000-000000000000';
const CARDS = `/boards/${BOARD}/cards`;
const page = (path: string, n: number) => `GET ${path}?page=${n}&limit=100`;

it('coalesces an update hint with its authoritative Card-list refresh', async () => {
  storeSession();
  const card = makeCard({ title: 'Before' });
  const saved = { ...card, title: 'After' };
  let finish!: (response: MockResponse) => void;
  const pending = new Promise<MockResponse>((resolve) => {
    finish = resolve;
  });
  let gets = 0;
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    [page(CARDS, 1)]: () => okPage(++gets === 1 ? [card] : [saved]),
    [`PATCH ${CARDS}/${card.id}`]: () => pending,
  });
  const { result } = renderHook(
    () => ({
      cards: useCards(BOARD),
      update: useUpdateCard(BOARD, card.id),
      client: useQueryClient(),
    }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.cards.isSuccess).toBe(true));
  const queue = createInvalidationQueue(result.current.client, 10);
  let mutation!: Promise<unknown>;
  try {
    act(() => {
      mutation = result.current.update.mutateAsync({ title: 'After' });
    });
    await waitFor(() =>
      expect(calls.some((call) => call.method === 'PATCH')).toBe(true),
    );
    queue.add([{ queryKey: boardKeys.cards(BOARD), exact: true }]);
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(gets).toBe(1);
    await act(async () => {
      finish(ok(saved));
      await mutation;
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(gets).toBe(2);
    expect(result.current.cards.data).toEqual([saved]);
  } finally {
    queue.dispose();
  }
});

it('refreshes only the affected 100-Card preview chunk', async () => {
  storeSession();
  const ids = Array.from(
    { length: 201 },
    (_, index) => `card-${String(index).padStart(3, '0')}`,
  );
  const calls = mockApi({ 'GET /users/me': ok(testUser) });
  const { result } = renderHook(
    () => ({
      preview: usePreviewSummaries(BOARD, ids),
      client: useQueryClient(),
    }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.preview.isSuccess).toBe(true));
  expect(result.current.preview.data).toHaveLength(201);
  const summaryCalls = () =>
    calls.filter((call) => call.path.includes('/card-preview-summaries?'));
  expect(summaryCalls()).toHaveLength(3);
  await act(() =>
    result.current.client.invalidateQueries(
      previewSummaryFilters(BOARD, ids[150]),
    ),
  );
  expect(summaryCalls()).toHaveLength(4);
  const refreshed = new URLSearchParams(summaryCalls()[3].path.split('?')[1])
    .get('cardIds')
    ?.split(',');
  expect(refreshed).toHaveLength(100);
  expect(refreshed).toContain(ids[150]);
  expect(refreshed).not.toContain(ids[0]);
});

it('does not expose other preview chunks if one is denied', async () => {
  storeSession();
  const ids = Array.from(
    { length: 101 },
    (_, index) => `card-${String(index).padStart(3, '0')}`,
  );
  const query = new URLSearchParams({ cardIds: ids.slice(100).join(',') });
  mockApi({
    'GET /users/me': ok(testUser),
    [`GET /boards/${BOARD}/card-preview-summaries?${query}`]: fail(
      403,
      'FORBIDDEN',
    ),
  });
  const { result } = renderHook(() => usePreviewSummaries(BOARD, ids), {
    wrapper,
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.data).toBeUndefined();
});

it('loads preview chunks one at a time and skips queued work after unmount', async () => {
  storeSession();
  const ids = Array.from(
    { length: 201 },
    (_, index) => `card-${String(index).padStart(3, '0')}`,
  );
  const query = new URLSearchParams({ cardIds: ids.slice(0, 100).join(',') });
  let finish!: (response: MockResponse) => void;
  const pending = new Promise<MockResponse>((resolve) => {
    finish = resolve;
  });
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    [`GET /boards/${BOARD}/card-preview-summaries?${query}`]: () => pending,
  });
  const hook = renderHook(() => usePreviewSummaries(BOARD, ids), { wrapper });
  await waitFor(() =>
    expect(
      calls.filter((call) => call.path.includes('/card-preview-summaries?')),
    ).toHaveLength(1),
  );
  hook.unmount();
  await act(async () => {
    finish(ok({ summaries: [] }));
    await pending;
  });
  expect(
    calls.filter((call) => call.path.includes('/card-preview-summaries?')),
  ).toHaveLength(1);
});

describe('card hooks', () => {
  it('loads all pages of filtered cards for additional views', async () => {
    storeSession();
    const first = makeCard({ title: 'Match one' });
    const second = makeCard({ title: 'Match two' });
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${CARDS}?page=1&limit=100&q=Match`]: okPage([first], {
        page: 1,
        total: 101,
      }),
      [`GET ${CARDS}?page=2&limit=100&q=Match`]: okPage([second], {
        page: 2,
        total: 101,
      }),
    });
    const { result } = renderHook(
      () => useAllFilteredCards(BOARD, { q: 'Match' }, true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([first, second]);
  });
  it('refreshes filtered results after a local card update without relying on realtime', async () => {
    storeSession();
    const card = makeCard({ title: 'Before' });
    const saved = { ...card, title: 'After' };
    let calls = 0;
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${CARDS}?page=1&limit=100&q=After`]: () =>
        okPage(++calls === 1 ? [] : [saved]),
      [`PATCH ${CARDS}/${card.id}`]: ok(saved),
    });
    const { result } = renderHook(
      () => ({
        filtered: useFilteredCards(BOARD, { q: 'After' }, 1, true),
        update: useUpdateCard(BOARD, card.id),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.filtered.isSuccess).toBe(true));
    await act(() => result.current.update.mutateAsync({ title: 'After' }));
    await waitFor(() =>
      expect(result.current.filtered.data?.items).toEqual([saved]),
    );
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('loads every page of active cards', async () => {
    storeSession();
    const first = makeCard();
    const second = makeCard();
    mockApi({
      'GET /users/me': ok(testUser),
      [page(CARDS, 1)]: okPage([first], { page: 1, total: 101 }),
      [page(CARDS, 2)]: okPage([second], { page: 2, total: 101 }),
    });

    const { result } = renderHook(() => useCards(BOARD), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([first, second]);
  });

  it('creates a card and refetches the list', async () => {
    storeSession();
    const card = makeCard({ title: 'Write tests' });
    let listCalls = 0;
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [page(CARDS, 1)]: () => {
        listCalls += 1;
        return okPage(listCalls === 1 ? [] : [card]);
      },
      [`POST ${CARDS}`]: ok(card, 201),
    });

    const { result } = renderHook(
      () => ({ cards: useCards(BOARD), create: useCreateCard(BOARD) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.cards.isSuccess).toBe(true));

    await act(() =>
      result.current.create.mutateAsync({
        columnId: card.columnId,
        title: 'Write tests',
      }),
    );

    await waitFor(() => expect(result.current.cards.data).toEqual([card]));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      columnId: card.columnId,
      title: 'Write tests',
    });
  });

  it('stores the updated card and sends only the given fields', async () => {
    storeSession();
    const card = makeCard({ description: 'old' });
    const saved = { ...card, description: null };
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${CARDS}/${card.id}`]: ok(card),
      [page(CARDS, 1)]: okPage([saved]),
      [`PATCH ${CARDS}/${card.id}`]: ok(saved),
    });

    const { result } = renderHook(
      () => ({
        card: useCard(BOARD, card.id),
        update: useUpdateCard(BOARD, card.id),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.card.isSuccess).toBe(true));

    await act(() => result.current.update.mutateAsync({ description: null }));

    await waitFor(() => expect(result.current.card.data).toEqual(saved));
    // Taken from the PATCH response, not refetched.
    const detailGets = calls.filter(
      (c) => c.method === 'GET' && c.path === `${CARDS}/${card.id}`,
    );
    expect(detailGets).toHaveLength(1);
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      description: null,
    });
  });

  it('drops an archived card from the active list', async () => {
    storeSession();
    const card = makeCard();
    let listCalls = 0;
    mockApi({
      'GET /users/me': ok(testUser),
      [page(CARDS, 1)]: () => {
        listCalls += 1;
        return okPage(listCalls === 1 ? [card] : []);
      },
      [`POST ${CARDS}/${card.id}/archive`]: ok({
        ...card,
        isArchived: true,
        archivedAt: '2026-10-17T00:00:00.000Z',
      }),
    });

    const { result } = renderHook(
      () => ({
        cards: useCards(BOARD),
        archive: useArchiveCard(BOARD, card.id),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.cards.isSuccess).toBe(true));

    await act(() => result.current.archive.mutateAsync());

    await waitFor(() => expect(result.current.cards.data).toEqual([]));
  });

  it('patches the list at once, even if its refetch fails', async () => {
    storeSession();
    const kept = makeCard({ title: 'Kept' });
    const archived = makeCard({ title: 'Archived' });
    let listCalls = 0;
    mockApi({
      'GET /users/me': ok(testUser),
      [page(CARDS, 1)]: () => {
        listCalls += 1;
        return listCalls === 1
          ? okPage([kept, archived])
          : fail(429, 'TOO_MANY_REQUESTS'); // not retried, unlike a 500
      },
      [`PATCH ${CARDS}/${kept.id}`]: ok({ ...kept, title: 'Renamed' }),
      [`POST ${CARDS}/${archived.id}/archive`]: ok({
        ...archived,
        isArchived: true,
        archivedAt: '2026-10-17T00:00:00.000Z',
      }),
    });

    const { result } = renderHook(
      () => ({
        cards: useCards(BOARD),
        update: useUpdateCard(BOARD, kept.id),
        archive: useArchiveCard(BOARD, archived.id),
      }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.cards.data).toEqual([kept, archived]),
    );

    await act(() => result.current.update.mutateAsync({ title: 'Renamed' }));
    // Replaced where it was, not moved to the end.
    await waitFor(() =>
      expect(result.current.cards.data).toEqual([
        { ...kept, title: 'Renamed' },
        archived,
      ]),
    );
    await act(() => result.current.archive.mutateAsync());

    expect(listCalls).toBeGreaterThan(1);
    await waitFor(() =>
      expect(result.current.cards.data).toEqual([
        { ...kept, title: 'Renamed' },
      ]),
    );
  });

  it('refetches the card after assigning and unassigning', async () => {
    storeSession();
    const card = makeCard();
    let detailCalls = 0;
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${CARDS}/${card.id}`]: () => {
        detailCalls += 1;
        return ok(card);
      },
      [`POST ${CARDS}/${card.id}/assignees`]: ok(
        { userId: 'u1', assignedById: testUser.id, createdAt: card.createdAt },
        201,
      ),
      [`DELETE ${CARDS}/${card.id}/assignees/u1`]: { status: 204 },
    });

    const { result } = renderHook(
      () => ({
        card: useCard(BOARD, card.id),
        assign: useAssignCard(BOARD, card.id),
        unassign: useUnassignCard(BOARD, card.id),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.card.isSuccess).toBe(true));

    await act(() => result.current.assign.mutateAsync('u1'));
    await waitFor(() => expect(detailCalls).toBe(2));
    await act(() => result.current.unassign.mutateAsync('u1'));
    await waitFor(() => expect(detailCalls).toBe(3));

    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      userId: 'u1',
    });
  });

  it('refetches the cards when the card was archived meanwhile', async () => {
    storeSession();
    const card = makeCard();
    let listCalls = 0;
    mockApi({
      'GET /users/me': ok(testUser),
      [page(CARDS, 1)]: () => {
        listCalls += 1;
        return okPage(listCalls === 1 ? [card] : []);
      },
      [`PATCH ${CARDS}/${card.id}`]: fail(409, 'CARD_ARCHIVED'),
    });

    const { result } = renderHook(
      () => ({ cards: useCards(BOARD), update: useUpdateCard(BOARD, card.id) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.cards.isSuccess).toBe(true));

    await act(() =>
      result.current.update
        .mutateAsync({ title: 'New' })
        .catch(() => undefined),
    );

    await waitFor(() => expect(result.current.cards.data).toEqual([]));
  });

  it('moves a card and resolves once the list is refetched', async () => {
    storeSession();
    const card = makeCard();
    const moved = { ...card, columnId: 'to', position: '50.0000000000' };
    let listCalls = 0;
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [page(CARDS, 1)]: () => {
        listCalls += 1;
        return okPage([listCalls === 1 ? card : moved]);
      },
      [`PATCH ${CARDS}/${card.id}/move`]: ok(moved),
    });

    const { result } = renderHook(
      () => ({ cards: useCards(BOARD), move: useMoveCard(BOARD) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.cards.isSuccess).toBe(true));

    let refetchedBeforeResolve = false;
    await act(async () => {
      await result.current.move.mutateAsync({
        cardId: card.id,
        toColumnId: 'to',
        beforeCardId: null,
      });
      // Already refetched when the promise resolves: no flicker on drop.
      refetchedBeforeResolve = listCalls === 2;
    });

    expect(refetchedBeforeResolve).toBe(true);
    await waitFor(() => expect(result.current.cards.data).toEqual([moved]));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      toColumnId: 'to',
      beforeCardId: null,
    });
  });

  it('refetches cards and columns when a move is refused', async () => {
    storeSession();
    const card = makeCard();
    let cardCalls = 0;
    let columnCalls = 0;
    mockApi({
      'GET /users/me': ok(testUser),
      [page(CARDS, 1)]: () => {
        cardCalls += 1;
        return okPage([card]);
      },
      [`GET /boards/${BOARD}/columns?page=1&limit=100`]: () => {
        columnCalls += 1;
        return okPage([]);
      },
      [`PATCH ${CARDS}/${card.id}/move`]: fail(404, 'COLUMN_NOT_FOUND'),
    });

    const { result } = renderHook(
      () => ({
        cards: useCards(BOARD),
        columns: useColumns(BOARD),
        move: useMoveCard(BOARD),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.columns.isSuccess).toBe(true));

    await act(() =>
      result.current.move
        .mutateAsync({
          cardId: card.id,
          toColumnId: 'gone',
          beforeCardId: null,
        })
        .catch(() => undefined),
    );

    await waitFor(() => expect(cardCalls).toBe(2));
    await waitFor(() => expect(columnCalls).toBe(2));
  });
});

it('does not reload preview summaries when only a card title changes', async () => {
  storeSession();
  const card = makeCard({ boardId: BOARD, title: 'Saved' });
  let summaryCalls = 0;
  let saving = false;
  mockApi({
    'GET /users/me': ok(testUser),
    [page(CARDS, 1)]: okPage([card]),
    [`PATCH ${CARDS}/${card.id}`]: ok(card),
    [`GET /boards/${BOARD}/card-preview-summaries?cardIds=${card.id}`]: () => {
      if (saving) summaryCalls++;
      return ok({ summaries: [] });
    },
  });
  const { result } = renderHook(
    () => ({
      cards: useCards(BOARD),
      preview: usePreviewSummaries(BOARD, [card.id]),
      update: useUpdateCard(BOARD, card.id),
    }),
    { wrapper },
  );
  await waitFor(() =>
    expect(
      result.current.preview.isSuccess && result.current.cards.isSuccess,
    ).toBe(true),
  );
  saving = true;
  await act(() => result.current.update.mutateAsync({ title: 'Saved' }));
  expect(result.current.update.isPending).toBe(false);
  expect(summaryCalls).toBe(0);
});
