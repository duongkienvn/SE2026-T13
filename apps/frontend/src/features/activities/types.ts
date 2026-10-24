import type { ActivityActionType, ActivityEntityType } from '@kanban/shared';

/**
 * Public H2a response (`ActivityResponseDto`). There are no actor, card or
 * column objects: names are resolved from what the client already knows.
 */
export interface Activity {
  id: string;
  boardId: string;
  /** The user id (not the membership id) of whoever acted. */
  actorId: string;
  actionType: ActivityActionType;
  entityType: ActivityEntityType;
  entityId: string | null;
  /** Action-specific and untrusted: read fields with type checks. */
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
