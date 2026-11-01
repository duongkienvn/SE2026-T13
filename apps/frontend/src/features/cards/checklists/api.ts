import { apiRequest } from '../../../lib/api-client';

/* Frontend copies of the P3-01 checklist DTOs (`checklist-response.dto.ts`). */

export interface ChecklistItem {
  id: string;
  checklistId: string;
  text: string;
  isChecked: boolean;
  /** Decimal string from the server; never parsed or invented client-side. */
  position: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistProgress {
  checkedItems: number;
  totalItems: number;
  /** 0–100, two decimals; an empty checklist is 0. */
  completionPercentage: number;
}

export interface Checklist extends ChecklistProgress {
  id: string;
  cardId: string;
  title: string;
  position: string;
  createdAt: string;
  updatedAt: string;
  items: ChecklistItem[];
}

export interface CardChecklists extends ChecklistProgress {
  cardId: string;
  checklists: Checklist[];
}

/** Backend limits (DTO trim + length) mirrored for helpful messages only. */
export const CHECKLIST_TITLE_MAX_LENGTH = 120;
export const CHECKLIST_ITEM_MAX_LENGTH = 255;

export type ChecklistAction =
  | { type: 'create'; title: string }
  | { type: 'rename'; checklistId: string; title: string }
  | { type: 'move'; checklistId: string; beforeChecklistId: string | null }
  | { type: 'delete'; checklistId: string }
  | { type: 'addItem'; checklistId: string; text: string }
  | { type: 'editItem'; checklistId: string; itemId: string; text: string }
  | {
      type: 'toggleItem';
      checklistId: string;
      itemId: string;
      isChecked: boolean;
    }
  | {
      type: 'moveItem';
      checklistId: string;
      itemId: string;
      beforeItemId: string | null;
    }
  | { type: 'deleteItem'; checklistId: string; itemId: string };

const id = encodeURIComponent;
const checklistsPath = (boardId: string, cardId: string) =>
  `/boards/${id(boardId)}/cards/${id(cardId)}/checklists`;

export function listChecklists(
  token: string,
  boardId: string,
  cardId: string,
  signal?: AbortSignal,
): Promise<CardChecklists> {
  return apiRequest<CardChecklists>(checklistsPath(boardId, cardId), {
    accessToken: token,
    signal,
  });
}

/** Sends one action; deletes resolve to `undefined` (204). */
export function runChecklistAction(
  token: string,
  boardId: string,
  cardId: string,
  action: ChecklistAction,
): Promise<Checklist | undefined> {
  const base = checklistsPath(boardId, cardId);
  const send = (
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ) =>
    apiRequest<Checklist | undefined>(`${base}${path}`, {
      method,
      body,
      accessToken: token,
    });
  switch (action.type) {
    case 'create':
      return send('POST', '', { title: action.title });
    case 'rename':
      return send('PATCH', `/${id(action.checklistId)}`, {
        title: action.title,
      });
    case 'move':
      return send('PATCH', `/${id(action.checklistId)}/move`, {
        beforeChecklistId: action.beforeChecklistId,
      });
    case 'delete':
      return send('DELETE', `/${id(action.checklistId)}`);
    case 'addItem':
      return send('POST', `/${id(action.checklistId)}/items`, {
        text: action.text,
      });
    case 'editItem':
      return send(
        'PATCH',
        `/${id(action.checklistId)}/items/${id(action.itemId)}`,
        { text: action.text },
      );
    case 'toggleItem':
      return send(
        'PATCH',
        `/${id(action.checklistId)}/items/${id(action.itemId)}`,
        { isChecked: action.isChecked },
      );
    case 'moveItem':
      return send(
        'PATCH',
        `/${id(action.checklistId)}/items/${id(action.itemId)}/move`,
        { beforeItemId: action.beforeItemId },
      );
    case 'deleteItem':
      return send(
        'DELETE',
        `/${id(action.checklistId)}/items/${id(action.itemId)}`,
      );
  }
}
