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

@Injectable()
export class BoardsService {
  constructor(
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    @InjectRepository(BoardMember)
    private readonly members: Repository<BoardMember>,
    private readonly authorization: BoardAuthorizationService,
    private readonly activities: ActivityWriterService,
  ) {}

  async archive(userId: string, boardId: string): Promise<BoardResponseDto> {
    return this.boards.manager.transaction(async (manager) => {
      const { board, member } = await this.authorization.requireMutableOwner(
        userId,
        boardId,
        manager,
      );
      board.isArchived = true;
      board.archivedAt = new Date();
      return toBoardResponseDto(
        await manager.getRepository(Board).save(board),
        member.role,
      );
    });
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
    const { board, member } = await this.authorization.requireMember(
      userId,
      boardId,
    );
    return toBoardResponseDto(board, member.role);
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
    query: PageQueryDto,
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
        .innerJoinAndSelect(
          'board.members',
          'member',
          'member.userId = :userId',
          { userId },
        )
        .where('board.isArchived = :isArchived', { isArchived: false }),
      query,
      'createdAt',
      'DESC',
    );
    return paginate(
      page.data.map((board) =>
        toBoardResponseDto(board, board.members[0].role),
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
      const board = await boards.save(
        boards.create({
          name: input.name,
          description: input.description ?? null,
          createdById: userId,
        }),
      );
      const member = await members.save(
        members.create({
          boardId: board.id,
          userId,
          role: BoardMemberRole.OWNER,
        }),
      );
      return toBoardResponseDto(board, member.role);
    });
  }
}
