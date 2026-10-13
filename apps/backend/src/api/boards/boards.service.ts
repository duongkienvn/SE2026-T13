import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BoardMember } from '../board-members/entities/board-member.entity';
import { Board } from './entities/board.entity';
import { BoardMemberRole } from '../../common/enums/database-enums';
import { CreateBoardDto } from './dto/create-board.dto';
import { BoardResponseDto, toBoardResponseDto } from './dto/board-response.dto';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import {
  PaginatedResponse,
  paginate,
} from '../../common/dto/paginated-response';
import { paginateQueryBuilder } from '../../utils/offset-pagination';
import { ApplicationException } from '../../exceptions/application.exception';
import { ErrorCode } from '../../common/dto/api-error';

@Injectable()
export class BoardsService {
  constructor(
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    @InjectRepository(BoardMember)
    private readonly members: Repository<BoardMember>,
  ) {}

  async getDetail(userId: string, boardId: string): Promise<BoardResponseDto> {
    const member = await this.members.findOne({
      where: { boardId, userId },
      relations: { board: true },
    });
    if (!member) throw this.notFound();
    return toBoardResponseDto(member.board, member.role);
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
