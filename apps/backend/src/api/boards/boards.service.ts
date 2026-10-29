import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BoardMember } from '../board-members/entities/board-member.entity';
import { Board } from './entities/board.entity';
import {
  ActivityActionType,
  ActivityEntityType,
  BoardMemberRole,
} from '../../common/enums/database-enums';
import { ActivityWriterService } from '../activities/activity-writer.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { BoardResponseDto, toBoardResponseDto } from './dto/board-response.dto';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import {
  PaginatedResponse,
  paginate,
  pageOffset,
} from '../../common/dto/paginated-response';
import { paginateQueryBuilder } from '../../utils/offset-pagination';
import { ApplicationException } from '../../exceptions/application.exception';
import { ErrorCode } from '../../common/dto/api-error';
import { UpdateBoardDto } from './dto/update-board.dto';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { BoardEventPublisher } from '../../realtime/board-event-publisher.service';
import { BoardVisibility, RealtimeServerEvent } from '@kanban/shared';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { requireBoardCreation } from '../workspaces/workspace-policy';
import {
  readableBoardPredicate,
  readableBoardParameters,
} from '../board-members/board-permissions';

@Injectable()
export class BoardsService {
  constructor(
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    @InjectRepository(BoardMember)
    private readonly members: Repository<BoardMember>,
    private readonly authorization: BoardAuthorizationService,
    private readonly activities: ActivityWriterService,
    private readonly events: BoardEventPublisher,
    private readonly workspaces: WorkspacesService,
  ) {}

  async archive(userId: string, boardId: string): Promise<BoardResponseDto> {
    const saved = await this.boards.manager.transaction(async (manager) => {
      const { board, member } = await this.authorization.requireMutableOwner(
        userId,
        boardId,
        manager,
      );
      board.isArchived = true;
      board.archivedAt = new Date();
      const saved = await manager.getRepository(Board).save(board);
      await this.activities.record(manager, {
        boardId,
        actorId: userId,
        actionType: ActivityActionType.BOARD_ARCHIVED,
        entityType: ActivityEntityType.BOARD,
        entityId: boardId,
        metadata: null,
      });
      return toBoardResponseDto(saved, member.role);
    });
    await this.events.publish(RealtimeServerEvent.BOARD_ARCHIVED, { boardId });
    return saved;
  }

  async restore(userId: string, boardId: string): Promise<BoardResponseDto> {
    const saved = await this.boards.manager.transaction(async (manager) => {
      const { board, member } = await this.authorization.requireOwner(
        userId,
        boardId,
        manager,
      );
      if (!board.isArchived) {
        throw new ApplicationException(
          HttpStatus.CONFLICT,
          ErrorCode.BOARD_NOT_ARCHIVED,
          'Board is not archived',
        );
      }
      board.workspace = await manager
        .getRepository(Workspace)
        .findOneByOrFail({ id: board.workspaceId });
      board.isArchived = false;
      board.archivedAt = null;
      const saved = await manager.getRepository(Board).save(board);
      await this.activities.record(manager, {
        boardId,
        actorId: userId,
        actionType: ActivityActionType.BOARD_RESTORED,
        entityType: ActivityEntityType.BOARD,
        entityId: boardId,
        metadata: null,
      });
      return toBoardResponseDto(saved, member.role);
    });
    await this.events.publish(RealtimeServerEvent.BOARD_RESTORED, { boardId });
    return saved;
  }

  async update(
    userId: string,
    boardId: string,
    input: UpdateBoardDto,
  ): Promise<BoardResponseDto> {
    if (input.name === undefined && input.description === undefined) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'Validation failed',
        ['At least one board field must be provided'],
      );
    }
    return this.boards.manager.transaction(async (manager) => {
      const { board, member } = await this.authorization.requireMutableOwner(
        userId,
        boardId,
        manager,
      );
      board.workspace = await manager
        .getRepository(Workspace)
        .findOneByOrFail({ id: board.workspaceId });
      const changed =
        (input.name !== undefined && input.name !== board.name) ||
        (input.description !== undefined &&
          input.description !== board.description);
      if (!changed) return toBoardResponseDto(board, member.role);
      if (input.name !== undefined) board.name = input.name;
      if (input.description !== undefined)
        board.description = input.description;
      const saved = await manager.getRepository(Board).save(board);
      await this.activities.record(manager, {
        boardId: saved.id,
        actorId: userId,
        actionType: ActivityActionType.BOARD_UPDATED,
        entityType: ActivityEntityType.BOARD,
        entityId: saved.id,
        metadata: null,
      });
      return toBoardResponseDto(saved, member.role);
    });
  }

  async getDetail(userId: string, boardId: string): Promise<BoardResponseDto> {
    const { board, member } = await this.authorization.requireRead(
      userId,
      boardId,
    );
    if (member?.role === BoardMemberRole.OWNER && !board.isArchived)
      board.workspace = await this.boards.manager
        .getRepository(Workspace)
        .findOneByOrFail({ id: board.workspaceId });
    return toBoardResponseDto(board, member?.role ?? null);
  }

  private notFound(): ApplicationException {
    return new ApplicationException(
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      'Board not found',
    );
  }

  async list(
    userId: string,
    query: PageQueryDto & { status?: 'active' | 'archived' },
  ): Promise<PaginatedResponse<BoardResponseDto>> {
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
      this.boards
        .createQueryBuilder('board')
        .innerJoinAndSelect('board.workspace', 'boardWorkspace')
        .leftJoinAndSelect(
          'board.members',
          'member',
          'member.userId = :userId',
          { userId },
        )
        .where(readableBoardPredicate, readableBoardParameters(userId))
        .andWhere('board.isArchived = :isArchived', {
          isArchived: query.status === 'archived',
        }),
      query,
      query.status === 'archived' ? 'archivedAt' : 'createdAt',
      'DESC',
    );
    return paginate(
      page.data.map((board) =>
        toBoardResponseDto(board, board.members[0]?.role ?? null),
      ),
      page.meta.total,
      query,
    );
  }

  async create(
    userId: string,
    input: CreateBoardDto,
  ): Promise<BoardResponseDto> {
    return this.boards.manager.transaction(async (manager) => {
      const boards = manager.getRepository(Board);
      const members = manager.getRepository(BoardMember);
      const workspaceId =
        input.workspaceId ??
        (await this.workspaces.ensurePersonalWorkspace(userId, manager)).id;
      const workspaceMember = await this.workspaces.requireMember(
        userId,
        workspaceId,
        manager,
      );
      requireBoardCreation(workspaceMember);
      const workspace = workspaceMember.workspace;
      const board = await boards.save(
        boards.create({
          name: input.name,
          description: input.description ?? null,
          createdById: userId,
          workspaceId: workspace.id,
          visibility: BoardVisibility.PRIVATE,
        }),
      );
      const member = await members.save(
        members.create({
          boardId: board.id,
          userId,
          role: BoardMemberRole.OWNER,
        }),
      );
      board.workspace = workspace;
      return toBoardResponseDto(board, member.role);
    });
  }
}
