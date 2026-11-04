import { HttpStatus, Injectable } from '@nestjs/common';
import { NotificationKind, RealtimeServerEvent } from '@kanban/shared';
import { randomUUID } from 'node:crypto';
import { NotificationService } from '../notifications/notification.service';
import { NotificationEventPublisher } from '../../realtime/notification-event-publisher.service';
import { BoardEventPublisher } from '../../realtime/board-event-publisher.service';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CardAssignee } from '../cards/entities/card-assignee.entity';
import { Board } from '../boards/entities/board.entity';
import { ErrorCode } from '../../common/dto/api-error';
import {
  PaginatedResponse,
  paginate,
  pageOffset,
} from '../../common/dto/paginated-response';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import {
  ActivityActionType,
  ActivityEntityType,
  BoardMemberRole,
} from '../../common/enums/database-enums';
import { ActivityWriterService } from '../activities/activity-writer.service';
import { ApplicationException } from '../../exceptions/application.exception';
import { paginateQueryBuilder } from '../../utils/offset-pagination';
import { User } from '../users/entities/user.entity';
import { AddBoardMemberDto } from './dto/add-board-member.dto';
import {
  BoardMemberResponseDto,
  toBoardMemberResponseDto,
} from './dto/board-member-response.dto';
import { UpdateBoardMemberRoleDto } from './dto/update-board-member-role.dto';
import { BoardAuthorizationService } from './board-authorization.service';
import { BoardMember } from './entities/board-member.entity';
import { BoardRoomCoordinator } from '../../realtime/board-room-coordinator.service';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { requireBoardPolicy } from '../workspaces/workspace-policy';
import { BoardMemberAddedNotificationService } from './board-member-added-notification.service';

@Injectable()
export class BoardMembersService {
  constructor(
    @InjectRepository(BoardMember)
    private readonly members: Repository<BoardMember>,
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    private readonly authorization: BoardAuthorizationService,
    private readonly realtimeAccess: BoardRoomCoordinator,
    private readonly events: BoardEventPublisher,
    private readonly activities: ActivityWriterService,
    private readonly notifications: BoardMemberAddedNotificationService,
    private readonly inbox: NotificationService,
    private readonly notificationEvents: NotificationEventPublisher,
  ) {}

  async list(
    userId: string,
    boardId: string,
    query: PageQueryDto,
  ): Promise<PaginatedResponse<BoardMemberResponseDto>> {
    await this.authorization.requireMember(userId, boardId);
    try {
      pageOffset(query);
    } catch {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Validation failed',
        ['Pagination offset must be a safe integer'],
      );
    }
    const page = await paginateQueryBuilder(
      this.members
        .createQueryBuilder('member')
        .innerJoinAndSelect('member.user', 'user')
        .where('member.boardId = :boardId', { boardId }),
      query,
      'joinedAt',
      'ASC',
    );
    return paginate(
      page.data.map(toBoardMemberResponseDto),
      page.meta.total,
      query,
    );
  }

  async add(
    userId: string,
    boardId: string,
    input: AddBoardMemberDto,
  ): Promise<BoardMemberResponseDto> {
    const result = await this.boards.manager.transaction(async (manager) => {
      const { board } = await this.authorization.requireMutableOwner(
        userId,
        boardId,
        manager,
      );
      await requireBoardPolicy(
        manager,
        board.workspaceId,
        'boardInvitesEnabled',
      );
      const email = input.email.trim().toLowerCase();
      const users = manager.getRepository(User);
      const members = manager.getRepository(BoardMember);
      const user = await users.findOne({ where: { email } });
      if (!user) throw this.userNotFound();
      const existing = await members.findOne({
        where: { boardId, userId: user.id },
        relations: { user: true },
      });
      if (existing) throw this.memberConflict();
      const member = await members.save(
        members.create({
          boardId,
          userId: user.id,
          role: BoardMemberRole.MEMBER,
          user,
        }),
      );
      await this.activities.record(manager, {
        boardId: member.boardId,
        actorId: userId,
        actionType: ActivityActionType.MEMBER_ADDED,
        entityType: ActivityEntityType.MEMBER,
        entityId: member.id,
        metadata: null,
      });
      const actor = await users.findOne({ where: { id: userId } });
      const notified = await this.recordChange(
        manager,
        boardId,
        userId,
        member.userId,
        `add:${member.id}`,
      );
      return {
        notified,
        member: toBoardMemberResponseDto(member),
        notification: {
          membershipId: member.id,
          boardId: board.id,
          boardName: board.name,
          actorDisplayName: actor?.displayName,
          recipient: user.email,
          recipientDisplayName: user.displayName,
        },
      };
    });
    await this.notificationEvents.afterCommit(result.notified);
    await this.events.publish(RealtimeServerEvent.MEMBER_ADDED, {
      boardId: boardId.toLowerCase(),
      userId: result.member.user.id,
    });
    await this.notifications.notify(result.notification);
    return result.member;
  }

  async updateRole(
    actorId: string,
    boardId: string,
    targetUserId: string,
    input: UpdateBoardMemberRoleDto,
  ): Promise<BoardMemberResponseDto> {
    let changed = false;
    let notified: string[] = [];
    const result = await this.boards.manager.transaction(async (manager) => {
      const { board } = await this.authorization.requireMutableOwner(
        actorId,
        boardId,
        manager,
      );
      await requireBoardPolicy(
        manager,
        board.workspaceId,
        'boardMembershipChangesEnabled',
      );
      const members = manager.getRepository(BoardMember);
      const member = await members.findOne({
        where: { boardId, userId: targetUserId },
        relations: { user: true },
      });
      if (!member) throw this.memberNotFound();
      if (
        member.userId === actorId &&
        member.role === BoardMemberRole.OWNER &&
        input.role !== BoardMemberRole.OWNER
      ) {
        throw this.selfDemotionConflict();
      }
      if (
        member.userId === board.createdById &&
        input.role !== BoardMemberRole.OWNER
      ) {
        throw this.creatorConflict();
      }
      if (
        member.role === BoardMemberRole.OWNER &&
        input.role === BoardMemberRole.MEMBER &&
        (await members.count({
          where: { boardId, role: BoardMemberRole.OWNER },
        })) <= 1
      ) {
        throw this.lastOwnerConflict();
      }
      if (member.role === input.role) return toBoardMemberResponseDto(member);
      const fromRole = member.role;
      changed = true;
      member.role = input.role;
      const saved = await members.save(member);
      notified = await this.recordChange(
        manager,
        boardId,
        actorId,
        saved.userId,
        `role:${randomUUID()}`,
      );
      await this.activities.record(manager, {
        boardId: saved.boardId,
        actorId,
        actionType: ActivityActionType.ROLE_CHANGED,
        entityType: ActivityEntityType.MEMBER,
        entityId: saved.id,
        metadata: { fromRole, toRole: saved.role },
      });
      return toBoardMemberResponseDto(saved);
    });
    await this.notificationEvents.afterCommit(notified);
    if (changed)
      await this.events.publish(RealtimeServerEvent.MEMBER_ROLE_CHANGED, {
        boardId: boardId.toLowerCase(),
        userId: result.user.id,
      });
    return result;
  }

  async remove(
    actorId: string,
    boardId: string,
    targetUserId: string,
  ): Promise<void> {
    const payload = await this.realtimeAccess.run(boardId, async () => {
      const removed = await this.boards.manager.transaction(async (manager) => {
        const { board } = await this.authorization.requireMutableOwner(
          actorId,
          boardId,
          manager,
        );
        await requireBoardPolicy(
          manager,
          board.workspaceId,
          'boardMembershipChangesEnabled',
        );
        const members = manager.getRepository(BoardMember);
        const member = await members.findOne({
          where: { boardId, userId: targetUserId },
        });
        if (!member) throw this.memberNotFound();
        if (member.userId === actorId) throw this.selfRemovalConflict();
        if (member.userId === board.createdById) throw this.creatorConflict();
        if (member.role === BoardMemberRole.OWNER) {
          const ownerCount = await members.count({
            where: { boardId, role: BoardMemberRole.OWNER },
          });
          if (ownerCount <= 1) throw this.lastOwnerConflict();
        }
        await this.deleteAssignments(manager, boardId, member.userId);
        await members.delete({ id: member.id });
        const notified = await this.recordChange(
          manager,
          boardId,
          actorId,
          member.userId,
          `remove:${member.id}`,
        );
        await this.activities.record(manager, {
          boardId: board.id,
          actorId,
          actionType: ActivityActionType.MEMBER_REMOVED,
          entityType: ActivityEntityType.MEMBER,
          entityId: member.id,
          metadata: { targetUserId: member.userId },
        });
        const retainsReadAccess =
          board.visibility === 'WORKSPACE_VISIBLE' &&
          (await manager.getRepository(WorkspaceMember).existsBy({
            workspaceId: board.workspaceId,
            userId: member.userId,
          }));
        return {
          boardId: board.id,
          userId: member.userId,
          visibility: board.visibility,
          retainsReadAccess,
          notified,
        };
      });
      if (removed.visibility === 'WORKSPACE_VISIBLE') {
        await this.realtimeAccess.reconcileBoard(removed.boardId, (userId) =>
          this.authorization.canReadBoard(userId, removed.boardId),
        );
      } else {
        await this.realtimeAccess.evictUser(removed.boardId, removed.userId);
      }
      return {
        boardId: removed.boardId,
        userId: removed.userId,
        notified: removed.notified,
        ...(removed.retainsReadAccess ? { retainsReadAccess: true } : {}),
      };
    });
    await this.notificationEvents.afterCommit(payload.notified);
    // emitToBoard takes the same queue: publish only after run has released it.
    await this.events.publish(RealtimeServerEvent.MEMBER_REMOVED, {
      boardId: payload.boardId,
      userId: payload.userId,
      ...(payload.retainsReadAccess ? { retainsReadAccess: true } : {}),
    });
  }

  private async recordChange(
    manager: EntityManager,
    boardId: string,
    actorUserId: string,
    recipientUserId: string,
    occurrenceKey: string,
  ): Promise<string[]> {
    if (actorUserId === recipientUserId) return [];
    const result = await this.inbox.record(manager, {
      kind: NotificationKind.MEMBERSHIP_CHANGED,
      boardId,
      actorUserId,
      recipientUserId,
      occurrenceKey,
    });
    return result.status === 'created' ? [result.recipientUserId] : [];
  }

  private async deleteAssignments(
    manager: EntityManager,
    boardId: string,
    userId: string,
  ): Promise<void> {
    await manager
      .getRepository(CardAssignee)
      .createQueryBuilder()
      .delete()
      .from(CardAssignee)
      .where('user_id = :userId', { userId })
      .andWhere(
        'card_id IN (SELECT id FROM "cards" WHERE "board_id" = :boardId)',
        { boardId },
      )
      .execute();
  }

  private userNotFound(): ApplicationException {
    return new ApplicationException(
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      'User not found',
    );
  }

  private memberNotFound(): ApplicationException {
    return new ApplicationException(
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      'Board member not found',
    );
  }

  private memberConflict(): ApplicationException {
    return new ApplicationException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      'User is already a member of this board',
    );
  }

  private creatorConflict(): ApplicationException {
    return new ApplicationException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      'The board creator cannot be demoted or removed',
    );
  }

  private lastOwnerConflict(): ApplicationException {
    return new ApplicationException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      'The board must retain at least one OWNER',
    );
  }

  private selfRemovalConflict(): ApplicationException {
    return new ApplicationException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      'Owners cannot remove themselves through this endpoint',
    );
  }

  private selfDemotionConflict(): ApplicationException {
    return new ApplicationException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      'Owners cannot demote themselves through this endpoint',
    );
  }
}
