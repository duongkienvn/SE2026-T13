import type { SessionIdentity } from '../api/session-client.ts';

export type FilterValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly FilterValue[]
  | { readonly [key: string]: FilterValue };
export type Filters = Readonly<Record<string, FilterValue>>;

/** Sort object properties; omit undefined; preserve array order and opaque cursors. */
export function normalizeFilters(
  value: FilterValue,
): Exclude<FilterValue, undefined> {
  if (value === undefined) return null;
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('Invalid query-key number');
  if (Array.isArray(value)) return value.map(normalizeFilters);
  if (value && typeof value === 'object') {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new Error('Query keys require plain values');
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, normalizeFilters(item)]),
    );
  }
  return value as Exclude<FilterValue, undefined>;
}

function scope(identity: SessionIdentity) {
  return ['mobile', 'private', identity.userId, identity.generation] as const;
}
function board(identity: SessionIdentity, boardId: string) {
  return [...scope(identity), 'boards', boardId.toLowerCase()] as const;
}
function notifications(identity: SessionIdentity) {
  return [...scope(identity), 'notifications'] as const;
}

/** These are cache identities, not claims that every resource has an adapter. */
export const queryKeys = {
  private: ['mobile', 'private'] as const,
  scope,
  me: (identity: SessionIdentity) => [...scope(identity), 'me'] as const,
  workspaces: (identity: SessionIdentity, filters: Filters = {}) =>
    [...scope(identity), 'workspace-lists', normalizeFilters(filters)] as const,
  workspace: (identity: SessionIdentity, workspaceId: string) =>
    [...scope(identity), 'workspaces', workspaceId.toLowerCase()] as const,
  boards: (
    identity: SessionIdentity,
    workspaceId: string | null,
    filters: Filters = {},
  ) =>
    [
      ...scope(identity),
      'board-lists',
      workspaceId?.toLowerCase() ?? null,
      normalizeFilters(filters),
    ] as const,
  board,
  cardPreview: (identity: SessionIdentity, boardId: string, cardId: string) =>
    [...board(identity, boardId), 'previews', cardId.toLowerCase()] as const,
  boardLists: (identity: SessionIdentity) =>
    [...scope(identity), 'board-lists'] as const,
  columns: (identity: SessionIdentity, id: string) =>
    [...board(identity, id), 'columns'] as const,
  members: (identity: SessionIdentity, id: string) =>
    [...board(identity, id), 'members'] as const,
  labels: (identity: SessionIdentity, id: string) =>
    [...board(identity, id), 'labels'] as const,
  comments: (identity: SessionIdentity, boardId: string, cardId: string) =>
    [
      ...board(identity, boardId),
      'cards',
      cardId.toLowerCase(),
      'comments',
    ] as const,
  checklists: (identity: SessionIdentity, boardId: string, cardId: string) =>
    [
      ...board(identity, boardId),
      'cards',
      cardId.toLowerCase(),
      'checklists',
    ] as const,
  attachments: (identity: SessionIdentity, boardId: string, cardId: string) =>
    [
      ...board(identity, boardId),
      'cards',
      cardId.toLowerCase(),
      'attachments',
    ] as const,
  home: (identity: SessionIdentity) => [...scope(identity), 'home'] as const,
  tasks: (identity: SessionIdentity) => [...scope(identity), 'tasks'] as const,
  search: (identity: SessionIdentity) =>
    [...scope(identity), 'search'] as const,
  cards: (identity: SessionIdentity, boardId: string, filters: Filters = {}) =>
    [
      ...board(identity, boardId),
      'card-lists',
      normalizeFilters(filters),
    ] as const,
  card: (identity: SessionIdentity, boardId: string, cardId: string) =>
    [...board(identity, boardId), 'cards', cardId.toLowerCase()] as const,
  notifications,
  notificationList: (identity: SessionIdentity, filters: Filters = {}) =>
    [...notifications(identity), 'list', normalizeFilters(filters)] as const,
  unreadCount: (identity: SessionIdentity) =>
    [...notifications(identity), 'unread-count'] as const,
};

export type PrivateQueryKey = readonly [
  'mobile',
  'private',
  string,
  number,
  ...unknown[],
];
export function keyBelongsTo(
  key: readonly unknown[],
  identity: SessionIdentity,
): key is PrivateQueryKey {
  return (
    key[0] === 'mobile' &&
    key[1] === 'private' &&
    key[2] === identity.userId &&
    key[3] === identity.generation
  );
}
