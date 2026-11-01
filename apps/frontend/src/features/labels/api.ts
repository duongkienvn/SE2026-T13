import {
  apiRequest,
  apiRequestPage,
  fetchAllPages,
  MAX_PAGE_LIMIT,
} from '../../lib/api-client';

/* Frontend copies of the P3-02 Board-scoped label DTOs. */

export interface Label {
  id: string;
  boardId: string;
  name: string;
  /** Canonical uppercase `#RRGGBB`. */
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface CardLabels {
  cardId: string;
  labels: Label[];
}

export interface LabelInput {
  name: string;
  color: string;
}

export const LABEL_NAME_MAX_LENGTH = 120;
export const MAX_BOARD_LABELS = 200;

const id = encodeURIComponent;
const catalogPath = (boardId: string) => `/boards/${id(boardId)}/labels`;
const cardLabelsPath = (boardId: string, cardId: string) =>
  `/boards/${id(boardId)}/cards/${id(cardId)}/labels`;

/** The whole catalog (at most 200 labels, so two pages). */
export function listLabels(
  token: string,
  boardId: string,
  signal?: AbortSignal,
): Promise<Label[]> {
  return fetchAllPages((page) =>
    apiRequestPage<Label>(
      `${catalogPath(boardId)}?${new URLSearchParams({
        page: String(page),
        limit: String(MAX_PAGE_LIMIT),
      })}`,
      { accessToken: token, signal },
    ),
  );
}

export function createLabel(token: string, boardId: string, input: LabelInput) {
  return apiRequest<Label>(catalogPath(boardId), {
    method: 'POST',
    body: input,
    accessToken: token,
  });
}

export function updateLabel(
  token: string,
  boardId: string,
  labelId: string,
  input: Partial<LabelInput>,
) {
  return apiRequest<Label>(`${catalogPath(boardId)}/${id(labelId)}`, {
    method: 'PATCH',
    body: input,
    accessToken: token,
  });
}

export function deleteLabel(token: string, boardId: string, labelId: string) {
  return apiRequest<void>(`${catalogPath(boardId)}/${id(labelId)}`, {
    method: 'DELETE',
    accessToken: token,
  });
}

export function listCardLabels(
  token: string,
  boardId: string,
  cardId: string,
  signal?: AbortSignal,
): Promise<CardLabels> {
  return apiRequest<CardLabels>(cardLabelsPath(boardId, cardId), {
    accessToken: token,
    signal,
  });
}

export function assignLabel(
  token: string,
  boardId: string,
  cardId: string,
  labelId: string,
) {
  return apiRequest<CardLabels>(cardLabelsPath(boardId, cardId), {
    method: 'POST',
    body: { labelId },
    accessToken: token,
  });
}

export function unassignLabel(
  token: string,
  boardId: string,
  cardId: string,
  labelId: string,
) {
  return apiRequest<void>(`${cardLabelsPath(boardId, cardId)}/${id(labelId)}`, {
    method: 'DELETE',
    accessToken: token,
  });
}
