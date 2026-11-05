import { Injectable } from '@nestjs/common';
import type { AccountDataExport } from '@kanban/shared';
import { EntityManager, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserPreferences } from '../users/entities/user-preferences.entity';
import { DEFAULT_USER_PREFERENCES } from '../users/user-preferences.constants';
import { GoogleIdentity } from '../auth/entities/google-identity.entity';
import { NotificationPreference } from '../notifications/entities/notification-preference.entity';
import { toNotificationPreferences } from '../notifications/notification-preferences';
import { UserNotification } from '../notifications/entities/user-notification.entity';
import { BoardMember } from '../board-members/entities/board-member.entity';
import { Board } from '../boards/entities/board.entity';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { Comment } from '../comments/entities/comment.entity';
import {
  readableBoardParameters,
  readableBoardPredicate,
} from '../board-members/board-permissions';
import { ApplicationException } from '../../exceptions/application.exception';
import { ExportBuffer } from './export-buffer';
import { ExportSnapshot, exportPages } from './export-snapshot';
import { selectFields } from './board-export.service';

export interface AccountExportResult {
  body: Buffer;
  /** Only exported grants are retained, not content or a cached permission result. */
  boards: Map<string, { workspaceId: string; role?: string }>;
  workspaces: Map<string, string>;
}
@Injectable()
export class AccountExportService {
  constructor(private readonly snapshots: ExportSnapshot) {}
  create(userId: string): Promise<AccountExportResult> {
    return this.snapshots.read(async (manager) => {
      const output = new ExportBuffer();
      const boards: AccountExportResult['boards'] = new Map();
      const workspaces: AccountExportResult['workspaces'] = new Map();
      const user = await manager.getRepository(User).findOneOrFail({
        select: {
          id: true,
          email: true,
          displayName: true,
          emailVerifiedAt: true,
          createdAt: true,
          updatedAt: true,
          avatarUrl: true,
        },
        where: { id: userId },
      });
      const profile: AccountDataExport['profile'] = {
        userId,
        email: user.email,
        displayName: user.displayName,
        emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        avatarUrl: publicAvatar(user.avatarUrl),
      };
      const preferences = await manager
        .getRepository(UserPreferences)
        .findOneBy({ userId });
      const notificationPreferences = await manager
        .getRepository(NotificationPreference)
        .findOneBy({ userId });
      const password = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .select('user.passwordHash IS NOT NULL', 'linked')
        .where('user.id = :userId', { userId })
        .getRawOne<{ linked: boolean }>();
      output.append('{"schemaVersion":1,"generatedAt":');
      output.json(new Date().toISOString());
      output.append(',"profile":');
      output.json(profile);
      output.append(',"preferences":');
      output.json({
        theme: preferences?.theme ?? DEFAULT_USER_PREFERENCES.theme,
        timeZone: preferences?.timeZone ?? DEFAULT_USER_PREFERENCES.timeZone,
        dateFormat:
          preferences?.dateFormat ?? DEFAULT_USER_PREFERENCES.dateFormat,
        weekStartsOn:
          preferences?.weekStartsOn ?? DEFAULT_USER_PREFERENCES.weekStartsOn,
        notifications: toNotificationPreferences(notificationPreferences),
      } satisfies AccountDataExport['preferences']);
      output.append(',"linkedProviders":');
      output.json({
        password: password?.linked ?? false,
        google: await manager
          .getRepository(GoogleIdentity)
          .existsBy({ userId }),
      });
      const array = async <T>(
        name: string,
        query: SelectQueryBuilder<ObjectLiteral>,
        map: (row: T) => unknown = (row) => row,
      ) => {
        output.append(',"' + name + '":[');
        let first = true;
        for await (const page of exportPages<T>(query))
          for (const row of page) {
            if (!first) output.append(',');
            first = false;
            output.json(map(row));
          }
        output.append(']');
      };
      const memberships = selectFields(
        manager.getRepository(WorkspaceMember).createQueryBuilder('membership'),
        'membership',
        ['workspaceId', 'role'],
      )
        .innerJoin('membership.workspace', 'workspace')
        .addSelect('workspace.name', 'name')
        .addSelect('workspace.type', 'type')
        .where('membership.userId = :userId', { userId })
        .orderBy('membership.workspaceId', 'ASC');
      await array<AccountDataExport['workspaceMemberships'][number]>(
        'workspaceMemberships',
        memberships,
        (row) => {
          workspaces.set(row.workspaceId, row.role);
          return row;
        },
      );
      const boardMemberships = selectFields(
        manager.getRepository(BoardMember).createQueryBuilder('membership'),
        'membership',
        ['boardId', 'role'],
      )
        .innerJoin('membership.board', 'board')
        .addSelect('board.name', 'name')
        .addSelect('board.workspaceId', 'workspaceId')
        .where('membership.userId = :userId', { userId })
        .andWhere(readableBoardPredicate, readableBoardParameters(userId))
        .orderBy('membership.boardId', 'ASC');
      await array<AccountDataExport['boardMemberships'][number]>(
        'boardMemberships',
        boardMemberships,
        (row) => {
          boards.set(row.boardId, {
            workspaceId: row.workspaceId,
            role: row.role,
          });
          return row;
        },
      );
      // Context is deliberately ID-free for retained notifications: even a formerly
      // accessible Board/Card ID can disclose a relationship after access loss.
      const notifications = selectFields(
        manager
          .getRepository(UserNotification)
          .createQueryBuilder('notification'),
        'notification',
        ['id', 'kind', 'createdAt', 'readAt'],
      )
        .where('notification.recipientUserId = :userId', { userId })
        .orderBy('notification.createdAt', 'ASC')
        .addOrderBy('notification.id', 'ASC');
      await array<
        Pick<
          AccountDataExport['notifications'][number],
          'id' | 'kind' | 'createdAt' | 'readAt'
        >
      >('notifications', notifications, (row) => ({
        ...row,
        workspaceId: null,
        boardId: null,
        cardId: null,
      }));
      const comments = selectFields(
        manager.getRepository(Comment).createQueryBuilder('comment'),
        'comment',
        ['id', 'cardId', 'content', 'createdAt', 'updatedAt'],
      )
        .innerJoin('comment.card', 'card')
        .innerJoin('card.board', 'board')
        .addSelect('board.id', 'boardId')
        .addSelect('board.workspaceId', 'workspaceId')
        .where('comment.authorId = :userId', { userId })
        .andWhere(readableBoardPredicate, readableBoardParameters(userId))
        .orderBy('comment.createdAt', 'ASC')
        .addOrderBy('comment.id', 'ASC');
      await array<
        AccountDataExport['comments'][number] & { workspaceId: string }
      >('comments', comments, (row) => {
        const { workspaceId, ...comment } = row;
        if (!boards.has(row.boardId)) boards.set(row.boardId, { workspaceId });
        return comment;
      });
      output.append('}');
      return { body: output.finish(), boards, workspaces };
    });
  }
  async recheck(
    userId: string,
    result: AccountExportResult,
    manager: EntityManager,
  ): Promise<void> {
    const boardIds = [...result.boards.keys()];
    for (let offset = 0; offset < boardIds.length; offset += 100) {
      const ids = boardIds.slice(offset, offset + 100);
      const rows = await manager
        .getRepository(Board)
        .createQueryBuilder('board')
        .select('board.id', 'id')
        .addSelect('board.workspaceId', 'workspaceId')
        .leftJoin(
          BoardMember,
          'membership',
          'membership.boardId = board.id AND membership.userId = :userId',
          { userId },
        )
        .addSelect('membership.role', 'role')
        .where('board.id IN (:...ids)', { ids })
        .andWhere(readableBoardPredicate, readableBoardParameters(userId))
        .getRawMany<{ id: string; workspaceId: string; role: string | null }>();
      if (
        rows.length !== ids.length ||
        rows.some((row) => {
          const previous = result.boards.get(row.id)!;
          return (
            previous.workspaceId !== row.workspaceId ||
            (previous.role !== undefined && previous.role !== row.role)
          );
        })
      )
        throw accessChanged();
    }
    const workspaceIds = [...result.workspaces.keys()];
    for (let offset = 0; offset < workspaceIds.length; offset += 100) {
      const ids = workspaceIds.slice(offset, offset + 100);
      const rows = await manager
        .getRepository(WorkspaceMember)
        .createQueryBuilder('membership')
        .where(
          'membership.userId = :userId AND membership.workspaceId IN (:...ids)',
          { userId, ids },
        )
        .getMany();
      if (
        rows.length !== ids.length ||
        rows.some((row) => row.role !== result.workspaces.get(row.workspaceId))
      )
        throw accessChanged();
    }
  }
}
function accessChanged(): ApplicationException {
  return new ApplicationException(
    403,
    'FORBIDDEN',
    'Access changed during export; retry the download',
  );
}
/** Only external public URLs; uploaded private avatars are never exported. */
export function publicAvatar(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}
