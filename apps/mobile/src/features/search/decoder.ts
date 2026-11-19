import type {
  GlobalSearchItem,
  GlobalSearchResults,
  SearchGroup,
} from '@kanban/shared';
import { invalidResponse } from '../../infrastructure/api/errors.ts';
import {
  destinationPath,
  parsePath,
  parseResourceId,
} from '../../navigation/routes.ts';
import { searchGroups, type SearchRequest } from './input.ts';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidResponse(200);
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, allowEmpty = false) {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && !value.trim()) ||
    [...value].length > max ||
    /[\u0000\uD800-\uDFFF]/u.test(value)
  )
    throw invalidResponse(200);
  return value;
}
function id(value: unknown) {
  if (typeof value !== 'string' || !parseResourceId(value))
    throw invalidResponse(200);
  return parseResourceId(value)!;
}
export function searchDestination(item: GlobalSearchItem) {
  const destination = parsePath(item.path);
  const itemId = id(item.id);
  if (
    !destination ||
    !(item.type === 'workspace'
      ? destination.kind === 'workspace' && destination.workspaceId === itemId
      : item.type === 'board'
        ? destination.kind === 'board' && destination.boardId === itemId
        : item.type === 'card' &&
          destination.kind === 'card' &&
          destination.cardId === itemId &&
          destination.boardId === id(item.boardId))
  )
    throw invalidResponse(200);
  return destinationPath(destination);
}
function item(value: unknown, group: string): GlobalSearchItem {
  const row = object(value);
  const base = {
    id: id(row.id),
    title: text(row.title, 500),
    path: text(row.path, 200),
  };
  let result: GlobalSearchItem;
  if (
    group === 'workspaces' &&
    row.type === 'workspace' &&
    row.subtitle === null
  )
    result = { ...base, type: 'workspace', subtitle: null };
  else {
    const context = {
      workspaceId: id(row.workspaceId),
      workspaceName:
        row.workspaceName === null ? null : text(row.workspaceName, 120),
    };
    if (
      group === 'boards' &&
      row.type === 'board' &&
      row.subtitle === row.workspaceName
    )
      result = {
        ...base,
        ...context,
        type: 'board',
        subtitle: context.workspaceName,
      };
    else if (group === 'cards' && row.type === 'card')
      result = {
        ...base,
        ...context,
        type: 'card',
        boardId: id(row.boardId),
        boardName: text(row.boardName, 500),
        subtitle: row.subtitle === null ? null : text(row.subtitle, 160, true),
      };
    else throw invalidResponse(200);
  }
  searchDestination(result);
  return result;
}
export function decodeSearch(
  value: unknown,
  request: SearchRequest,
): GlobalSearchResults {
  const result = object(value);
  if (result.query !== request.q || result.type !== request.type)
    throw invalidResponse(200);
  const groups = object(result.groups);
  const decoded = searchGroups.map((key) => {
    const group = object(groups[key]);
    if (
      !Number.isSafeInteger(group.total) ||
      Number(group.total) < 0 ||
      typeof group.hasMore !== 'boolean' ||
      !Array.isArray(group.items) ||
      group.items.length > request.limit
    )
      throw invalidResponse(200);
    const total = Number(group.total);
    const items = Array.from(group.items, (row) => item(row, key));
    const offset = ((request.page ?? 1) - 1) * request.limit;
    const selected = request.type === 'all' || request.type === key;
    if (
      new Set(items.map((row) => row.id)).size !== items.length ||
      (selected
        ? items.length !==
            Math.min(request.limit, Math.max(0, total - offset)) ||
          group.hasMore !== total - offset > request.limit
        : total !== 0 || items.length !== 0 || group.hasMore)
    )
      throw invalidResponse(200);
    return [key, { items, total, hasMore: group.hasMore }] as const;
  });
  // Each group was decoded using its own discriminant above.
  return {
    query: request.q,
    type: request.type,
    groups: Object.fromEntries(decoded) as {
      workspaces: SearchGroup<Extract<GlobalSearchItem, { type: 'workspace' }>>;
      boards: SearchGroup<Extract<GlobalSearchItem, { type: 'board' }>>;
      cards: SearchGroup<Extract<GlobalSearchItem, { type: 'card' }>>;
    },
  };
}
