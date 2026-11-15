import { isCardDateInstant, type CardDateInput } from '@kanban/shared';
import { ApiError, invalidResponse } from '../../infrastructure/api/errors.ts';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../infrastructure/api/session-client.ts';
import { isUuid } from '../../infrastructure/auth/credential-record.ts';
import { queryKeys } from '../../infrastructure/query/keys.ts';
import {
  createKanbanApi,
  normalizeKanbanFilters,
  type KanbanFilters,
} from '../boards/kanban-api.ts';
import { decodeCard, type Card } from './decoder.ts';

export type CardPatch = CardDateInput & {
  title?: string;
  description?: string | null;
};
export type CreateCard = CardPatch & { columnId: string; title: string };
export type MoveCard = { toColumnId: string; beforeCardId: string | null };

function invalid(message: string) {
  return new ApiError('http', {
    status: 400,
    code: 'INVALID_CARD_INPUT',
    message,
  });
}

function uuid(value: string) {
  if (!isUuid(value)) throw invalid('Select a valid card or column.');
  return value.toLowerCase();
}

export function cardTitle(value: string) {
  if (typeof value !== 'string') throw invalid('Enter a card title.');
  const title = value.trim();
  if (!title) throw invalid('Enter a card title.');
  if ([...title].length > 120)
    throw invalid('Card title must be at most 120 characters.');
  return title;
}

function fields({ title, description, startDate, dueDate }: CardPatch) {
  if (description != null && [...description].length > 2000)
    throw invalid('Description must be at most 2,000 characters.');
  for (const value of [startDate, dueDate])
    if (value != null && !isCardDateInstant(value))
      throw invalid('Enter a date and time with Z or a UTC offset.');
  return {
    ...(title !== undefined && { title: cardTitle(title) }),
    ...(description !== undefined && { description }),
    ...(startDate !== undefined && { startDate }),
    ...(dueDate !== undefined && { dueDate }),
  };
}

export function createCardApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
  boardId: string,
) {
  const board = uuid(boardId);
  const path = `/boards/${board}/cards`;
  const readers = createKanbanApi(api, identity, board);
  function readOrWrite(
    method: 'GET' | 'POST' | 'PATCH',
    suffix: string,
    status: 200 | 201,
    cardId: string | undefined,
    signal: AbortSignal,
    matches: (card: Card) => boolean,
    body?: Record<string, unknown>,
  ) {
    return api.json(
      path + suffix,
      (value) => {
        const card = decodeCard(value, board);
        if (!matches(card)) throw invalidResponse(status);
        return card;
      },
      {
        identity,
        signal,
        method,
        body,
        retries: 0,
        expectedStatus: status,
        resourceKey: cardId
          ? queryKeys.card(identity, board, cardId)
          : queryKeys.cards(identity, board),
      },
    );
  }
  const listCards = (
    filters: KanbanFilters,
    page: number,
    signal: AbortSignal,
  ) => readers.cards(normalizeKanbanFilters(filters), page, signal);

  return {
    listCards,
    listArchivedCards: (page: number, signal: AbortSignal) =>
      listCards({ status: 'archived' }, page, signal),
    getCard(cardId: string, signal: AbortSignal) {
      const id = uuid(cardId);
      return readOrWrite(
        'GET',
        `/${id}`,
        200,
        id,
        signal,
        (card) => card.id === id,
      );
    },
    create(input: CreateCard, signal: AbortSignal) {
      const columnId = uuid(input.columnId);
      const body = {
        ...fields(input),
        title: cardTitle(input.title),
        columnId,
      };
      return readOrWrite(
        'POST',
        '',
        201,
        undefined,
        signal,
        (card) => !card.isArchived && card.columnId === columnId,
        body,
      );
    },
    update(cardId: string, patch: CardPatch, signal: AbortSignal) {
      const id = uuid(cardId);
      const body = fields(patch);
      if (!Object.keys(body).length)
        throw invalid('Change at least one card field.');
      return readOrWrite(
        'PATCH',
        `/${id}`,
        200,
        id,
        signal,
        (card) => card.id === id && !card.isArchived,
        body,
      );
    },
    move(cardId: string, input: MoveCard, signal: AbortSignal) {
      const id = uuid(cardId);
      const toColumnId = uuid(input.toColumnId);
      const beforeCardId =
        input.beforeCardId === null ? null : uuid(input.beforeCardId);
      if (beforeCardId === id)
        throw invalid('A card cannot be moved before itself.');
      return readOrWrite(
        'PATCH',
        `/${id}/move`,
        200,
        id,
        signal,
        (card) =>
          card.id === id && card.columnId === toColumnId && !card.isArchived,
        { toColumnId, beforeCardId },
      );
    },
    duplicate(
      cardId: string,
      columnId: string | undefined,
      signal: AbortSignal,
    ) {
      const id = uuid(cardId);
      const target = columnId === undefined ? undefined : uuid(columnId);
      return readOrWrite(
        'POST',
        `/${id}/duplicate`,
        201,
        id,
        signal,
        (card) =>
          card.id !== id &&
          !card.isArchived &&
          !card.assignees.length &&
          (target === undefined || card.columnId === target),
        target === undefined ? {} : { columnId: target },
      );
    },
    archive(cardId: string, signal: AbortSignal) {
      const id = uuid(cardId);
      return readOrWrite(
        'POST',
        `/${id}/archive`,
        200,
        id,
        signal,
        (card) => card.id === id && card.isArchived,
      );
    },
    restore(cardId: string, signal: AbortSignal) {
      const id = uuid(cardId);
      return readOrWrite(
        'POST',
        `/${id}/restore`,
        200,
        id,
        signal,
        (card) => card.id === id && !card.isArchived,
      );
    },
  };
}
