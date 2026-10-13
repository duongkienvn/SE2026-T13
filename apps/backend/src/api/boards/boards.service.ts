import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BoardMember } from '../board-members/entities/board-member.entity';
import { Board } from './entities/board.entity';
import { BoardMemberRole } from '../../common/enums/database-enums';
import { CreateBoardDto } from './dto/create-board.dto';
import { BoardResponseDto, toBoardResponseDto } from './dto/board-response.dto';

@Injectable()
export class BoardsService {
  constructor(
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    @InjectRepository(BoardMember)
    private readonly members: Repository<BoardMember>,
  ) {}

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
