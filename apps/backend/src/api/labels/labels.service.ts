import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { Board } from '../boards/entities/board.entity';
import { ApplicationException } from '../../exceptions/application.exception';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import {
  paginate,
  pageOffset,
  PaginatedResponse,
} from '../../common/dto/paginated-response';
import { BoardLabel } from './entities/board-label.entity';
import { LabelResponseDto, toLabelResponse } from './dto/label-response.dto';

export const MAX_BOARD_LABELS = 200;
interface Mutation<T> {
  value: T;
  changed: boolean;
  labelId: string;
}

@Injectable()
export class LabelsService {
  constructor(
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    private readonly authorization: BoardAuthorizationService,
  ) {}

  async list(
    userId: string,
    boardId: string,
    query: PageQueryDto,
  ): Promise<PaginatedResponse<LabelResponseDto>> {
    await this.authorization.requireRead(userId, boardId);
    let offset: number;
    try {
      offset = pageOffset(query);
      if (query.limit > 100) throw new RangeError();
    } catch {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Invalid pagination',
      );
    }
    const [rows, total] = await this.boards.manager
      .getRepository(BoardLabel)
      .createQueryBuilder('label')
      .where('label.boardId = :boardId', { boardId })
      .orderBy('LOWER(label.name)', 'ASC')
      .addOrderBy('label.id', 'ASC')
      .skip(offset)
      .take(query.limit)
      .getManyAndCount();
    return paginate(rows.map(toLabelResponse), total, query);
  }

  create(
    userId: string,
    boardId: string,
    input: { name: string; color: string },
  ): Promise<LabelResponseDto> {
    return this.mutate(userId, boardId, async (manager, board) => {
      const repository = manager.getRepository(BoardLabel),
        name = input.name.trim();
      await this.requireUniqueName(manager, board.id, name);
      if ((await repository.countBy({ boardId: board.id })) >= MAX_BOARD_LABELS)
        throw new ApplicationException(
          HttpStatus.CONFLICT,
          'LABEL_LIMIT_REACHED',
          'Board label limit reached',
        );
      const label = await repository.save(
        repository.create({
          boardId: board.id,
          name,
          color: input.color.trim().toUpperCase(),
        }),
      );
      return {
        value: toLabelResponse(label),
        changed: true,
        labelId: label.id,
      };
    });
  }

  async update(
    userId: string,
    boardId: string,
    labelId: string,
    input: { name?: string; color?: string },
  ): Promise<LabelResponseDto> {
    if (input.name === undefined && input.color === undefined)
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'At least one label field must be provided',
      );
    return this.mutate(userId, boardId, async (manager, board) => {
      const label = await this.requireLabel(manager, board.id, labelId);
      const name = input.name?.trim() ?? label.name,
        color = input.color?.trim().toUpperCase() ?? label.color;
      const changed = name !== label.name || color !== label.color;
      if (changed) {
        if (name !== label.name)
          await this.requireUniqueName(manager, board.id, name, label.id);
        label.name = name;
        label.color = color;
        await manager.getRepository(BoardLabel).save(label);
      }
      return { value: toLabelResponse(label), changed, labelId: label.id };
    });
  }

  remove(userId: string, boardId: string, labelId: string): Promise<void> {
    return this.mutate(userId, boardId, async (manager, board) => {
      const label = await this.requireLabel(manager, board.id, labelId);
      await manager
        .getRepository(BoardLabel)
        .delete({ id: label.id, boardId: board.id });
      return { value: undefined, changed: true, labelId: label.id };
    });
  }

  private async mutate<T>(
    userId: string,
    boardId: string,
    operation: (manager: EntityManager, board: Board) => Promise<Mutation<T>>,
  ): Promise<T> {
    const result = await this.boards.manager.transaction(async (manager) => {
      const { board } = await this.authorization.requireMember(
        userId,
        boardId,
        { mutable: true },
        manager,
      );
      return operation(manager, board);
    });
    return result.value;
  }
  private async requireLabel(
    manager: EntityManager,
    boardId: string,
    labelId: string,
  ): Promise<BoardLabel> {
    const label = await manager
      .getRepository(BoardLabel)
      .findOneBy({ id: labelId, boardId });
    if (!label)
      throw new ApplicationException(
        HttpStatus.NOT_FOUND,
        'LABEL_NOT_FOUND',
        'Label not found',
      );
    return label;
  }
  private async requireUniqueName(
    manager: EntityManager,
    boardId: string,
    name: string,
    excludingId?: string,
  ): Promise<void> {
    const query = manager
      .getRepository(BoardLabel)
      .createQueryBuilder('label')
      .where('label.boardId = :boardId', { boardId })
      .andWhere('LOWER(label.name) = LOWER(:name)', { name });
    if (excludingId)
      query.andWhere('label.id <> :excludingId', { excludingId });
    if (await query.getExists())
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'LABEL_NAME_EXISTS',
        'A label with this name already exists in the Board',
      );
  }
}
