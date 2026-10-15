import { HttpStatus, Injectable } from '@nestjs/common';
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
import { BoardMemberRole } from '../../common/enums/database-enums';
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

@Injectable()
export class BoardMembersService {
  constructor(
    @InjectRepository(BoardMember)
    private readonly members: Repository<BoardMember>,
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    private readonly authorization: BoardAuthorizationService,
    private readonly realtimeAccess: BoardRoomCoordinator,
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
    return this.boards.manager.transaction(async (manager) => {
      await this.authorization.requireMutableOwner(userId, boardId, manager);
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
      return toBoardMemberResponseDto(member);
    });
  }

  async updateRole(
    actorId: string,
    boardId: string,
    targetUserId: string,
    input: UpdateBoardMemberRoleDto,
  ): Promise<BoardMemberResponseDto> {
    return this.boards.manager.transaction(async (manager) => {
      const { board } = await this.authorization.requireMutableOwner(
        actorId,
        boardId,
        manager,
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
      member.role = input.role;
      return toBoardMemberResponseDto(await members.save(member));
    });
  }

  async remove(
    actorId: string,
    boardId: string,
    targetUserId: string,
  ): Promise<void> {
    return this.realtimeAccess.run(boardId, async () => {
      await this.boards.manager.transaction(async (manager) => {
        const { board } = await this.authorization.requireMutableOwner(
          actorId,
          boardId,
          manager,
        );
        const members = manager.getRepository(BoardMember);
        const member = await members.findOne({
          where: { boardId, userId: targetUserId },
        });
        if (!member) throw this.memberNotFound();
        if (targetUserId === actorId) throw this.selfRemovalConflict();
        if (targetUserId === board.createdById) throw this.creatorConflict();
        if (member.role === BoardMemberRole.OWNER) {
          const ownerCount = await members.count({
            where: { boardId, role: BoardMemberRole.OWNER },
          });
          if (ownerCount <= 1) throw this.lastOwnerConflict();
        }
        await this.deleteAssignments(manager, boardId, targetUserId);
        await members.delete({ id: member.id });
      });
      await this.realtimeAccess.evictUser(boardId, targetUserId);
    });
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
