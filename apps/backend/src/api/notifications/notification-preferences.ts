import { NotificationKind } from '@kanban/shared';
import type { EntityManager } from 'typeorm';
import { User } from '../users/entities/user.entity';
import type { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationPreferencesDto } from './dto/notification-preferences.dto';
import { toResponseDto } from '../../common/dto/to-response-dto';

export const IN_APP_PREFERENCE_COLUMNS = {
  cardAssigned: 'inAppCardAssigned',
  commentMentioned: 'inAppCommentMentioned',
  workspaceInvited: 'inAppWorkspaceInvited',
  boardInvited: 'inAppBoardInvited',
  membershipChanged: 'inAppMembershipChanged',
  dueReminder: 'inAppDueReminder',
} as const;
export const EMAIL_PREFERENCE_COLUMNS = {
  cardAssigned: 'emailCardAssigned',
  commentMentioned: 'emailCommentMentioned',
  dueReminder: 'emailDueReminder',
} as const;
export const IN_APP_KIND_COLUMN = {
  [NotificationKind.CARD_ASSIGNED]: 'inAppCardAssigned',
  [NotificationKind.COMMENT_MENTIONED]: 'inAppCommentMentioned',
  [NotificationKind.WORKSPACE_INVITED]: 'inAppWorkspaceInvited',
  [NotificationKind.BOARD_INVITED]: 'inAppBoardInvited',
  [NotificationKind.MEMBERSHIP_CHANGED]: 'inAppMembershipChanged',
  [NotificationKind.DUE_REMINDER]: 'inAppDueReminder',
} as const;

/** Shared lock order for future inserts, preference updates and read-all.
 * NO KEY UPDATE serializes the recipient without blocking ordinary actor/user
 * FK KEY SHARE checks. Multi-recipient producers must acquire sorted user IDs.
 */
export async function lockNotificationRecipient(
  manager: EntityManager,
  userId: string,
): Promise<boolean> {
  return !!(await manager.getRepository(User).findOne({
    select: { id: true },
    where: { id: userId },
    lock: { mode: 'for_no_key_update' },
  }));
}

export function toNotificationPreferences(
  row?: NotificationPreference | null,
): NotificationPreferencesDto {
  return toResponseDto(NotificationPreferencesDto, {
    inApp: {
      cardAssigned: row?.inAppCardAssigned ?? true,
      commentMentioned: row?.inAppCommentMentioned ?? true,
      workspaceInvited: row?.inAppWorkspaceInvited ?? true,
      boardInvited: row?.inAppBoardInvited ?? true,
      membershipChanged: row?.inAppMembershipChanged ?? true,
      dueReminder: row?.inAppDueReminder ?? true,
    },
    email: {
      cardAssigned: row?.emailCardAssigned ?? false,
      commentMentioned: row?.emailCommentMentioned ?? false,
      dueReminder: row?.emailDueReminder ?? false,
    },
  });
}
