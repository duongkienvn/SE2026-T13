import type { User } from '../auth/types';
import type { BoardMember } from '../board-members/types';
import type { Activity } from './types';

/** Lowercase so a row reads "<actor> <action>", as in card-detail.png. */
const ACTION_LABELS: Record<string, string> = {
  BOARD_UPDATED: 'updated the board',
  MEMBER_ADDED: 'added a board member',
  MEMBER_REMOVED: 'removed a board member',
  ROLE_CHANGED: "changed a member's role",
  COLUMN_CREATED: 'created a column',
  COLUMN_UPDATED: 'updated a column',
  COLUMN_MOVED: 'reordered a column',
  COLUMN_DELETED: 'deleted a column',
  CARD_CREATED: 'created a card',
  CARD_UPDATED: 'updated a card',
  CARD_MOVED: 'moved a card',
  CARD_ARCHIVED: 'archived a card',
  COMMENT_CREATED: 'added a comment',
  COMMENT_UPDATED: 'edited a comment',
  COMMENT_DELETED: 'deleted a comment',
};

/** For action types added to the backend after this client was built. */
const FALLBACK_LABEL = 'made a change';

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  MEMBER: 'Member',
};

export interface ActivityDescription {
  action: string;
  /** Extra detail backed by valid metadata, e.g. "Member → Owner". */
  detail?: string;
}

/** Own keys only, so values like "__proto__" or "toString" miss. */
function lookup(
  labels: Record<string, string>,
  key: string | undefined,
): string | undefined {
  return key !== undefined && Object.hasOwn(labels, key)
    ? labels[key]
    : undefined;
}

function metadataString(
  metadata: Activity['metadata'],
  key: string,
): string | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/** Plain text only: never echoes ids or raw metadata. */
export function describeActivity(activity: Activity): ActivityDescription {
  const { actionType, metadata } = activity;

  if (actionType === 'CARD_MOVED') {
    const from = metadataString(metadata, 'fromColumnId');
    const to = metadataString(metadata, 'toColumnId');
    return {
      action: from && to && from === to ? 'reordered a card' : 'moved a card',
    };
  }

  if (actionType === 'ROLE_CHANGED') {
    const from = lookup(ROLE_LABELS, metadataString(metadata, 'fromRole'));
    const to = lookup(ROLE_LABELS, metadataString(metadata, 'toRole'));
    return {
      action: ACTION_LABELS.ROLE_CHANGED,
      detail: from && to ? `${from} → ${to}` : undefined,
    };
  }

  return { action: lookup(ACTION_LABELS, actionType) ?? FALLBACK_LABEL };
}

export interface ActivityActor {
  name: string;
  /** Present when the actor is still known, for the avatar. */
  user?: Pick<User, 'displayName' | 'avatarUrl'>;
}

/**
 * `actorId` is a user id: match it against `member.user.id`, never the
 * membership id. Actors who left the board are not looked up elsewhere.
 */
export function resolveActor(
  actorId: string,
  members: readonly BoardMember[],
  currentUser: User | null | undefined,
): ActivityActor {
  if (currentUser && currentUser.id === actorId) {
    return { name: 'You', user: currentUser };
  }
  const member = members.find((candidate) => candidate.user.id === actorId);
  if (member) return { name: member.user.displayName, user: member.user };
  return { name: 'Former member' };
}

/** A usable `<time dateTime>` value, or `undefined` for an invalid timestamp. */
export function validTimestamp(iso: string): string | undefined {
  return Number.isNaN(new Date(iso).getTime()) ? undefined : iso;
}
