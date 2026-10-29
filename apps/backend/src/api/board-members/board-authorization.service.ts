import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ErrorCode } from '../../common/dto/api-error';
import { BoardMemberRole } from '../../common/enums/database-enums';
import { ApplicationException } from '../../exceptions/application.exception';
import { Board } from '../boards/entities/board.entity';
import { BoardMember } from './entities/board-member.entity';
import {
  readableBoardParameters,
  readableBoardPredicate,
} from './board-permissions';

export interface BoardAccess {
  readonly board: Board;
  readonly member: BoardMember;
}

export interface BoardAuthorizationOptions {
  readonly owner?: boolean;
  readonly mutable?: boolean;
}

@Injectable()
export class BoardAuthorizationService {
  constructor(
    @InjectRepository(BoardMember)
    private readonly members: Repository<BoardMember>,
  ) {}

  async requireRead(
    userId: string,
    boardId: string,
  ): Promise<{
    readonly board: Board;
    readonly member: BoardMember | null;
  }> {
    const member = await this.members.findOne({
      where: { boardId, userId },
      relations: { board: true },
    });
    if (member) return { board: member.board, member };
    const board = await this.members.manager
      .getRepository(Board)
      .createQueryBuilder('board')
      .where('board.id = :boardId', { boardId })
      .andWhere(readableBoardPredicate, readableBoardParameters(userId))
      .getOne();
    if (!board) throw this.boardNotFound();
    return { board, member: null };
  }

  async canReadBoard(userId: string, boardId: string): Promise<boolean> {
    try {
      await this.requireRead(userId, boardId);
      return true;
    } catch (error) {
      if (error instanceof ApplicationException && error.getStatus() === 404)
        return false;
      throw error;
    }
  }

  async requireMember(
    userId: string,
    boardId: string,
    options: BoardAuthorizationOptions = {},
    manager?: EntityManager,
  ): Promise<BoardAccess> {
    const members = manager?.getRepository(BoardMember) ?? this.members;
    const board = manager
      ? await manager.getRepository(Board).findOne({
          where: { id: boardId },
          lock: { mode: 'pessimistic_write' },
        })
      : undefined;
    const member = await members.findOne({
      where: { boardId, userId },
      ...(manager ? {} : { relations: { board: true } }),
    });
    const accessBoard = board ?? member?.board;
    if (!accessBoard || !member) throw this.boardNotFound();
    if (options.owner && member.role !== BoardMemberRole.OWNER) {
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Only the board OWNER can perform this operation',
      );
    }
    if (options.mutable && accessBoard.isArchived) {
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'BOARD_ARCHIVED',
        'Archived boards cannot be modified',
      );
    }
    return { board: accessBoard, member };
  }

  requireOwner(
    userId: string,
    boardId: string,
    manager?: EntityManager,
  ): Promise<BoardAccess> {
    return this.requireMember(userId, boardId, { owner: true }, manager);
  }

  requireMutableOwner(
    userId: string,
    boardId: string,
    manager?: EntityManager,
  ): Promise<BoardAccess> {
    return this.requireMember(
      userId,
      boardId,
      { owner: true, mutable: true },
      manager,
    );
  }

  private boardNotFound(): ApplicationException {
    return new ApplicationException(
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      'Board not found',
    );
  }
}
