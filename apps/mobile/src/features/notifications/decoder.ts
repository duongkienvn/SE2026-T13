import {
  NotificationKind,
  isCardDateInstant,
  type NotificationResponse,
} from '@kanban/shared';
import { invalidResponse } from '../../infrastructure/api/errors.ts';
import {
  parsePath,
  parseResourceId,
  destinationPath,
  invitationRecipientPath,
} from '../../navigation/routes.ts';

const kinds = new Set<string>(Object.values(NotificationKind));
export const unavailableSummary = 'This notification is no longer available';
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidResponse(200);
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    [...value].length > max ||
    value.includes('\0') ||
    /[\uD800-\uDFFF]/u.test(value)
  )
    throw invalidResponse(200);
  return value;
}
export function notificationId(value: unknown) {
  if (typeof value !== 'string' || !parseResourceId(value))
    throw invalidResponse(200);
  return parseResourceId(value)!;
}
function instant(value: unknown) {
  if (!isCardDateInstant(value)) throw invalidResponse(200);
  return value;
}
export function count(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw invalidResponse(200);
  return Number(value);
}
export const decodeCount = (value: unknown) => count(record(value).count);
export const decodeReadAll = (value: unknown) =>
  count(record(value).updatedCount);

export function notificationDestination(item: NotificationResponse) {
  if (item.isUnavailable || !item.target) return null;
  const parsed = parsePath(item.target.path);
  const context = item.context;
  if (!parsed) return null;
  const match =
    item.target.kind === 'invitation'
      ? item.kind === 'WORKSPACE_INVITED' &&
        parsed.kind === 'workspaceInvitation'
      : item.target.kind === 'workspace'
        ? parsed.kind === 'workspace' &&
          (!context || context.workspaceId === parsed.workspaceId)
        : item.target.kind === 'board'
          ? parsed.kind === 'board' &&
            (!context || context.boardId === parsed.boardId)
          : item.target.kind === 'card' &&
            parsed.kind === 'card' &&
            (!context ||
              (context.boardId === parsed.boardId &&
                context.cardId === parsed.cardId));
  return match ? destinationPath(parsed) : null;
}
export function decodeNotification(
  value: unknown,
  invitationProof?: (id: string, proof: string) => void,
): NotificationResponse {
  const row = record(value);
  if (
    typeof row.kind !== 'string' ||
    !kinds.has(row.kind) ||
    typeof row.isUnavailable !== 'boolean'
  )
    throw invalidResponse(200);
  const base = {
    id: notificationId(row.id),
    kind: row.kind as NotificationResponse['kind'],
    createdAt: instant(row.createdAt),
    readAt: row.readAt === null ? null : instant(row.readAt),
    summary: text(row.summary, 1024),
    isUnavailable: row.isUnavailable,
  };
  const stub = (summary = base.summary): NotificationResponse => ({
    ...base,
    summary,
    isUnavailable: true,
    actor: null,
    context: null,
    target: null,
  });
  if (base.isUnavailable) return stub();
  let actor: NotificationResponse['actor'] = null;
  if (row.actor !== null) {
    const source = record(row.actor);
    if (source.isDeleted !== undefined && typeof source.isDeleted !== 'boolean')
      throw invalidResponse(200);
    actor = {
      id: notificationId(source.id),
      displayName: text(source.displayName, 300),
      ...(source.isDeleted !== undefined
        ? { isDeleted: source.isDeleted }
        : {}),
    };
    if (actor.isDeleted) actor.displayName = 'Deleted user';
  }
  let context: NotificationResponse['context'] = null;
  if (row.context !== null) {
    const source = record(row.context);
    context = {
      workspaceId:
        source.workspaceId === null ? null : notificationId(source.workspaceId),
      boardId: source.boardId === null ? null : notificationId(source.boardId),
      cardId: source.cardId === null ? null : notificationId(source.cardId),
    };
    if (context.cardId && !context.boardId) throw invalidResponse(200);
  }
  let target: NotificationResponse['target'] = null;
  let proof: string | undefined;
  if (row.target !== null) {
    const source = record(row.target);
    if (
      !['workspace', 'board', 'card', 'invitation'].includes(
        String(source.kind),
      ) ||
      typeof source.path !== 'string'
    )
      return stub(unavailableSummary);
    let path = source.path;
    if (source.kind === 'invitation') {
      const match = /^\/invitations\/workspace#proof=([A-Za-z0-9_-]{43})$/.exec(
        path,
      );
      if (!match || row.kind !== 'WORKSPACE_INVITED')
        return stub(unavailableSummary);
      proof = match[1];
      path = invitationRecipientPath;
    }
    target = {
      kind: source.kind as NonNullable<NotificationResponse['target']>['kind'],
      path,
    };
  }
  const result: NotificationResponse = { ...base, actor, context, target };
  if (target && !notificationDestination(result))
    return stub(unavailableSummary);
  if (proof) invitationProof?.(base.id, proof);
  return result;
}
export function decodeList(value: unknown) {
  if (!Array.isArray(value) || value.length > 20) throw invalidResponse(200);
  const rows = Array.from(value, (item) => decodeNotification(item));
  if (new Set(rows.map(({ id }) => id)).size !== rows.length)
    throw invalidResponse(200);
  for (let i = 1; i < rows.length; i++) {
    const previous = rows[i - 1]!,
      current = rows[i]!;
    // PostgreSQL orders microseconds which are truncated by Date.toISOString().
    // Equal wire instants do not prove equal database timestamps; keep server order.
    if (Date.parse(previous.createdAt) < Date.parse(current.createdAt))
      throw invalidResponse(200);
  }
  return rows;
}
