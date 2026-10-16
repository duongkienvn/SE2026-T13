import { HttpStatus, Injectable } from '@nestjs/common';
import { RealtimeServerEvent } from '@kanban/shared';
import { BoardEventPublisher } from '../../realtime/board-event-publisher.service';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ErrorCode } from '../../common/dto/api-error';
import {
  PaginatedResponse,
  paginate,
  pageOffset,
} from '../../common/dto/paginated-response';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { ApplicationException } from '../../exceptions/application.exception';
import { paginateQueryBuilder } from '../../utils/offset-pagination';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { Board } from '../boards/entities/board.entity';
import { Card } from '../cards/entities/card.entity';
import {
  appendPosition,
  positionAfter,
  positionBefore,
  positionBetween,
  rebalancePositions,
} from './columns-ordering';
import { CreateColumnDto } from './dto/create-column.dto';
import {
  ColumnResponseDto,
  toColumnResponseDto,
} from './dto/column-response.dto';
import { MoveColumnDto } from './dto/move-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';
import { BoardColumn } from './entities/board-column.entity';

function isForeignKeyViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError: unknown = error.driverError;
  return (
    typeof driverError === 'object' &&
    driverError !== null &&
    'code' in driverError &&
    driverError.code === '23503'
  );
}

@Injectable()
export class ColumnsService {
  constructor(
    @InjectRepository(BoardColumn)
    private readonly columns: Repository<BoardColumn>,
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    @InjectRepository(Card) private readonly cards: Repository<Card>,
    private readonly authorization: BoardAuthorizationService,
    private readonly events: BoardEventPublisher,
  ) {}

  async list(
    userId: string,
    boardId: string,
    query: PageQueryDto,
  ): Promise<PaginatedResponse<ColumnResponseDto>> {
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
      this.columns
        .createQueryBuilder('column')
        .where('column.boardId = :boardId', { boardId }),
      query,
      'position',
      'ASC',
    );
    return paginate(page.data.map(toColumnResponseDto), page.meta.total, query);
  }

  async create(
    userId: string,
    boardId: string,
    input: CreateColumnDto,
  ): Promise<ColumnResponseDto> {
    const result = await this.boards.manager.transaction(async (manager) => {
      await this.authorization.requireMember(
        userId,
        boardId,
        { mutable: true },
        manager,
      );
      const columns = manager.getRepository(BoardColumn);
      const last = await columns.findOne({
        where: { boardId },
        order: { position: 'DESC', id: 'DESC' },
      });
      const column = columns.create({
        boardId,
        name: input.name,
        position: appendPosition(last?.position),
      });
      return toColumnResponseDto(await columns.save(column));
    });
    await this.events.publish(RealtimeServerEvent.COLUMN_CREATED, {
      boardId: result.boardId,
      columnId: result.id,
    });
    return result;
  }

  async rename(
    userId: string,
    boardId: string,
    columnId: string,
    input: UpdateColumnDto,
  ): Promise<ColumnResponseDto> {
    let changed = false;
    const result = await this.boards.manager.transaction(async (manager) => {
      await this.authorization.requireMember(
        userId,
        boardId,
        { mutable: true },
        manager,
      );
      const columns = manager.getRepository(BoardColumn);
      const column = await columns.findOne({
        where: { id: columnId, boardId },
      });
      if (!column) throw this.columnNotFound();
      if (column.name === input.name) return toColumnResponseDto(column);
      changed = true;
      column.name = input.name;
      return toColumnResponseDto(await columns.save(column));
    });
    if (changed)
      await this.events.publish(RealtimeServerEvent.COLUMN_UPDATED, {
        boardId: result.boardId,
        columnId: result.id,
      });
    return result;
  }

  async move(
    userId: string,
    boardId: string,
    columnId: string,
    input: MoveColumnDto,
  ): Promise<ColumnResponseDto> {
    let changed = false;
    const result = await this.boards.manager.transaction(async (manager) => {
      await this.authorization.requireMember(
        userId,
        boardId,
        { mutable: true },
        manager,
      );
      const columns = manager.getRepository(BoardColumn);
      const current = await columns.find({
        where: { boardId },
        order: { position: 'ASC', id: 'ASC' },
      });
      const moving = current.find((column) => column.id === columnId);
      if (!moving) throw this.columnNotFound();
      if (input.beforeColumnId === columnId) {
        throw new ApplicationException(
          HttpStatus.BAD_REQUEST,
          'INVALID_COLUMN_MOVE',
          'Column cannot be moved before itself',
        );
      }
      const withoutMoving = current.filter((column) => column.id !== columnId);
      const targetIndex =
        input.beforeColumnId === null
          ? withoutMoving.length
          : withoutMoving.findIndex(
              (column) => column.id === input.beforeColumnId,
            );
      if (targetIndex < 0) throw this.columnNotFound();
      const currentIndex = current.findIndex(
        (column) => column.id === columnId,
      );
      if (currentIndex === targetIndex) return toColumnResponseDto(moving);
      changed = true;

      const ordered = [...withoutMoving];
      ordered.splice(targetIndex, 0, moving);
      const previous = ordered[targetIndex - 1];
      const next = ordered[targetIndex + 1];
      const nextPosition = previous
        ? next
          ? positionBetween(previous.position, next.position)
          : positionAfter(previous.position)
        : next
          ? positionBefore(next.position)
          : moving.position;
      if (nextPosition) {
        moving.position = nextPosition;
        return toColumnResponseDto(await columns.save(moving));
      }

      const positions = rebalancePositions(ordered.length);
      ordered.forEach((column, index) => {
        column.position = positions[index];
      });
      await columns.save(ordered);
      return toColumnResponseDto(moving);
    });
    if (changed)
      await this.events.publish(RealtimeServerEvent.COLUMN_MOVED, {
        boardId: result.boardId,
        columnId: result.id,
      });
    return result;
  }

  async remove(
    userId: string,
    boardId: string,
    columnId: string,
  ): Promise<void> {
    const payload = await this.boards.manager.transaction(async (manager) => {
      await this.authorization.requireMember(
        userId,
        boardId,
        { mutable: true },
        manager,
      );
      const columns = manager.getRepository(BoardColumn);
      const cards = manager.getRepository(Card);
      const column = await columns.findOne({
        where: { id: columnId, boardId },
      });
      if (!column) throw this.columnNotFound();
      if ((await cards.count({ where: { columnId: column.id } })) > 0) {
        throw this.columnNotEmpty();
      }
      // TypeORM remove clears the entity primary key; snapshot before deletion.
      const payload = { boardId: column.boardId, columnId: column.id };
      try {
        await columns.remove(column);
      } catch (error) {
        if (isForeignKeyViolation(error)) throw this.columnNotEmpty();
        throw error;
      }
      return payload;
    });
    await this.events.publish(RealtimeServerEvent.COLUMN_DELETED, payload);
  }

  private columnNotFound(): ApplicationException {
    return new ApplicationException(
      HttpStatus.NOT_FOUND,
      'COLUMN_NOT_FOUND',
      'Column not found',
    );
  }

  private columnNotEmpty(): ApplicationException {
    return new ApplicationException(
      HttpStatus.CONFLICT,
      'COLUMN_NOT_EMPTY',
      'Column cannot be deleted while cards reference it',
    );
  }
}
