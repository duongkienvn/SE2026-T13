import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../../app/AppProviders';
import { makeCard, okPage } from '../../test/board-fixtures';
import { fail, mockApi, ok, storeSession, testUser } from '../../test/mock-api';
import {
  useArchiveCard,
  useAssignCard,
  useCard,
  useCards,
  useCreateCard,
  useUnassignCard,
  useUpdateCard,
} from './hooks';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppProviders>{children}</AppProviders>
);

const BOARD = '00000000-0000-4000-9000-000000000000';
const CARDS = `/boards/${BOARD}/cards`;
const page = (path: string, n: number) => `GET ${path}?page=${n}&limit=100`;

describe('card hooks', () => {
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
});
