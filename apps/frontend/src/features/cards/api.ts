import {
  apiRequest,
  apiRequestPage,
  fetchAllPages,
  MAX_PAGE_LIMIT,
  type Page,
} from '../../lib/api-client';
import type {
  AssignCardRequest,
  Card,
  CardAssignee,
  CreateCardRequest,
  MoveCardRequest,
  UpdateCardRequest,
} from './types';

function cardsPath(boardId: string, cardId?: string): string {
  const base = `/boards/${encodeURIComponent(boardId)}/cards`;
  return cardId ? `${base}/${encodeURIComponent(cardId)}` : base;
}

/** One page of the board's active cards (archived cards are never listed). */
export function listCards(
  accessToken: string,
  boardId: string,
  page: number,
  signal?: AbortSignal,
): Promise<Page<Card>> {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(MAX_PAGE_LIMIT),
  });
  return apiRequestPage<Card>(`${cardsPath(boardId)}?${query}`, {
    accessToken,
    signal,
  });
}

export function listAllCards(
  accessToken: string,
  boardId: string,
  signal?: AbortSignal,
): Promise<Card[]> {
  return fetchAllPages((page) => listCards(accessToken, boardId, page, signal));
}

/** Also returns archived cards. */
export function getCard(
  accessToken: string,
  boardId: string,
  cardId: string,
  signal?: AbortSignal,
): Promise<Card> {
  return apiRequest<Card>(cardsPath(boardId, cardId), { accessToken, signal });
}

export function createCard(
  accessToken: string,
  boardId: string,
  input: CreateCardRequest,
): Promise<Card> {
  return apiRequest<Card>(cardsPath(boardId), {
    method: 'POST',
    body: input,
    accessToken,
  });
}

export function updateCard(
  accessToken: string,
  boardId: string,
  cardId: string,
  input: UpdateCardRequest,
): Promise<Card> {
  return apiRequest<Card>(cardsPath(boardId, cardId), {
    method: 'PATCH',
    body: input,
    accessToken,
  });
}

export function archiveCard(
  accessToken: string,
  boardId: string,
  cardId: string,
): Promise<Card> {
  return apiRequest<Card>(`${cardsPath(boardId, cardId)}/archive`, {
    method: 'POST',
    accessToken,
  });
}

export function moveCard(
  accessToken: string,
  boardId: string,
  cardId: string,
  input: MoveCardRequest,
): Promise<Card> {
  return apiRequest<Card>(`${cardsPath(boardId, cardId)}/move`, {
    method: 'PATCH',
    body: input,
    accessToken,
  });
}

/** Resolves to the new assignee, not the whole card. */
export function assignCard(
  accessToken: string,
  boardId: string,
  cardId: string,
  input: AssignCardRequest,
): Promise<CardAssignee> {
  return apiRequest<CardAssignee>(`${cardsPath(boardId, cardId)}/assignees`, {
    method: 'POST',
    body: input,
    accessToken,
  });
}

export function unassignCard(
  accessToken: string,
  boardId: string,
  cardId: string,
  userId: string,
): Promise<void> {
  return apiRequest<void>(
    `${cardsPath(boardId, cardId)}/assignees/${encodeURIComponent(userId)}`,
    { method: 'DELETE', accessToken },
  );
}
