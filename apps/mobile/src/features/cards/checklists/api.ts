import {
  ApiError,
  invalidResponse,
} from '../../../infrastructure/api/errors.ts';
import type {
  SessionHttpClient,
  SessionIdentity,
} from '../../../infrastructure/api/session-client.ts';
import { isUuid } from '../../../infrastructure/auth/credential-record.ts';
import { queryKeys } from '../../../infrastructure/query/keys.ts';

export const MAX_CHECKLISTS = 50;
export const MAX_ITEMS = 200;
export const TITLE_LENGTH = 120;
export const ITEM_LENGTH = 255;

export type Progress = {
  checkedItems: number;
  totalItems: number;
  completionPercentage: number;
};
type Row = {
  id: string;
  position: string;
  createdAt: string;
  updatedAt: string;
};
export type Item = Row & {
  checklistId: string;
  text: string;
  isChecked: boolean;
};
export type Checklist = Row &
  Progress & { cardId: string; title: string; items: Item[] };
export type ChecklistSummary = Progress & { cardId: string };
export type CardChecklists = ChecklistSummary & { checklists: Checklist[] };

export type ChecklistCommand =
  | { kind: 'create'; title: string }
  | { kind: 'rename'; checklistId: string; title: string }
  | { kind: 'move'; checklistId: string; beforeChecklistId: string | null }
  | { kind: 'delete'; checklistId: string }
  | { kind: 'addItem'; checklistId: string; text: string }
  | { kind: 'editItem'; checklistId: string; itemId: string; text: string }
  | { kind: 'toggle'; checklistId: string; itemId: string; isChecked: boolean }
  | {
      kind: 'moveItem';
      checklistId: string;
      itemId: string;
      beforeItemId: string | null;
    }
  | { kind: 'deleteItem'; checklistId: string; itemId: string };

export function textError(value: string, max: number) {
  const size = [...value.trim()].length;
  return size < 1 || size > max ? `Enter 1–${max} characters.` : undefined;
}

function badInput(message: string): never {
  throw new ApiError('http', {
    status: 400,
    code: 'INVALID_CHECKLIST_INPUT',
    message,
  });
}
function id(value: unknown) {
  if (!isUuid(value)) badInput('Select a valid checklist or item.');
  return value.toLowerCase();
}
function anchor(before: string | null, source: string) {
  if (before === null) return null;
  const target = id(before);
  if (source === target) badInput('Choose a different position.');
  return target;
}
function input(value: string, max: number) {
  const error = textError(value, max);
  if (error) badInput(error);
  return value.trim();
}

function object(value: unknown, status: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidResponse(status);
  return value as Record<string, unknown>;
}
function uuid(value: unknown, status: number) {
  if (!isUuid(value)) throw invalidResponse(status);
  return value.toLowerCase();
}
function row(value: Record<string, unknown>, status: number): Row {
  const { position, createdAt, updatedAt } = value;
  if (
    typeof position !== 'string' ||
    !/^-?\d+(?:\.\d+)?$/.test(position) ||
    typeof createdAt !== 'string' ||
    !Number.isFinite(Date.parse(createdAt)) ||
    typeof updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(updatedAt))
  )
    throw invalidResponse(status);
  return { id: uuid(value.id, status), position, createdAt, updatedAt };
}
function label(value: unknown, max: number, status: number) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    textError(value, max)
  )
    throw invalidResponse(status);
  return value;
}
function progress(
  value: Record<string, unknown>,
  maximum: number,
  status: number,
): Progress {
  const { checkedItems, totalItems, completionPercentage } = value;
  if (
    typeof checkedItems !== 'number' ||
    !Number.isInteger(checkedItems) ||
    typeof totalItems !== 'number' ||
    !Number.isInteger(totalItems) ||
    checkedItems < 0 ||
    checkedItems > totalItems ||
    totalItems > maximum ||
    completionPercentage !==
      (totalItems ? Math.round((checkedItems * 10000) / totalItems) / 100 : 0)
  )
    throw invalidResponse(status);
  return { checkedItems, totalItems, completionPercentage };
}
function unique(rows: Row[], status: number) {
  if (new Set(rows.map(({ id }) => id)).size !== rows.length)
    throw invalidResponse(status);
}
function decodeChecklist(
  raw: unknown,
  cardId: string,
  status: number,
): Checklist {
  const dto = object(raw, status);
  const fields = row(dto, status);
  if (
    uuid(dto.cardId, status) !== cardId ||
    !Array.isArray(dto.items) ||
    dto.items.length > MAX_ITEMS
  )
    throw invalidResponse(status);
  const items = dto.items.map((rawItem: unknown): Item => {
    const item = object(rawItem, status);
    if (
      uuid(item.checklistId, status) !== fields.id ||
      typeof item.isChecked !== 'boolean'
    )
      throw invalidResponse(status);
    return {
      ...row(item, status),
      checklistId: fields.id,
      text: label(item.text, ITEM_LENGTH, status),
      isChecked: item.isChecked,
    };
  });
  unique(items, status);
  const counts = progress(dto, MAX_ITEMS, status);
  if (
    counts.totalItems !== items.length ||
    counts.checkedItems !== items.filter((item) => item.isChecked).length
  )
    throw invalidResponse(status);
  return {
    ...fields,
    ...counts,
    cardId,
    title: label(dto.title, TITLE_LENGTH, status),
    items,
  };
}
function decodeSummary(raw: unknown, cardId: string): ChecklistSummary {
  const dto = object(raw, 200);
  if (uuid(dto.cardId, 200) !== cardId) throw invalidResponse(200);
  return { cardId, ...progress(dto, MAX_CHECKLISTS * MAX_ITEMS, 200) };
}
function decodeList(raw: unknown, cardId: string): CardChecklists {
  const dto = object(raw, 200);
  const summary = decodeSummary(dto, cardId);
  if (!Array.isArray(dto.checklists) || dto.checklists.length > MAX_CHECKLISTS)
    throw invalidResponse(200);
  const checklists = dto.checklists.map((value: unknown) =>
    decodeChecklist(value, cardId, 200),
  );
  unique(checklists, 200);
  if (
    summary.checkedItems !==
      checklists.reduce((total, row) => total + row.checkedItems, 0) ||
    summary.totalItems !==
      checklists.reduce((total, row) => total + row.totalItems, 0)
  )
    throw invalidResponse(200);
  return { ...summary, checklists };
}

export function createChecklistApi(
  api: SessionHttpClient,
  identity: SessionIdentity,
  boardId: string,
  cardId: string,
) {
  const board = id(boardId);
  const card = id(cardId);
  const resourceKey = queryKeys.checklists(identity, board, card);
  const base = `/boards/${board}/cards/${card}/checklists`;
  return {
    list: (signal: AbortSignal) =>
      api.json(base, (raw) => decodeList(raw, card), {
        identity,
        resourceKey,
        signal,
        expectedStatus: 200,
        retries: 0,
      }),
    summary: (signal: AbortSignal) =>
      api.json(`${base}/summary`, (raw) => decodeSummary(raw, card), {
        identity,
        resourceKey,
        signal,
        expectedStatus: 200,
        retries: 0,
      }),
    async write(command: ChecklistCommand, signal: AbortSignal) {
      const checklistId =
        'checklistId' in command ? id(command.checklistId) : undefined;
      const itemId = 'itemId' in command ? id(command.itemId) : undefined;
      const path = checklistId ? `${base}/${checklistId}` : base;
      const item = itemId ? `${path}/items/${itemId}` : `${path}/items`;
      // A write denial rechecks Board access without evicting this readable list.
      const options = {
        identity,
        resourceKey: [...resourceKey, 'write'] as const,
        signal,
        retries: 0 as const,
      };
      const send = (method: 'POST' | 'PATCH', url: string, body: object) => {
        const expectedStatus = method === 'POST' ? 201 : 200;
        return api.json(
          url,
          (raw) => {
            const result = decodeChecklist(raw, card, expectedStatus);
            if (
              (checklistId && result.id !== checklistId) ||
              (itemId && !result.items.some(({ id }) => id === itemId))
            )
              throw invalidResponse(expectedStatus);
            return result;
          },
          { ...options, method, body, expectedStatus },
        );
      };
      const remove = (url: string) =>
        api.empty(url, { ...options, method: 'DELETE', expectedStatus: 204 });
      switch (command.kind) {
        case 'create':
          return send('POST', path, {
            title: input(command.title, TITLE_LENGTH),
          });
        case 'rename':
          return send('PATCH', path, {
            title: input(command.title, TITLE_LENGTH),
          });
        case 'move':
          return send('PATCH', `${path}/move`, {
            beforeChecklistId: anchor(command.beforeChecklistId, checklistId!),
          });
        case 'delete':
          return remove(path);
        case 'addItem':
          return send('POST', item, { text: input(command.text, ITEM_LENGTH) });
        case 'editItem':
          return send('PATCH', item, {
            text: input(command.text, ITEM_LENGTH),
          });
        case 'toggle':
          return send('PATCH', item, { isChecked: command.isChecked });
        case 'moveItem':
          return send('PATCH', `${item}/move`, {
            beforeItemId: anchor(command.beforeItemId, itemId!),
          });
        case 'deleteItem':
          return remove(item);
      }
    },
  };
}
