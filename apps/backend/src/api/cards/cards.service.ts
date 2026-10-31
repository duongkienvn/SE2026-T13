import { HttpStatus, Injectable } from '@nestjs/common';
import { RealtimeServerEvent } from '@kanban/shared';
import { BoardEventPublisher } from '../../realtime/board-event-publisher.service';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ApplicationException } from '../../exceptions/application.exception';
import {
  ActivityActionType,
  ActivityEntityType,
} from '../../common/enums/database-enums';
import { ActivityWriterService } from '../activities/activity-writer.service';
import {
  paginate,
  pageOffset,
  PaginatedResponse,
} from '../../common/dto/paginated-response';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { Board } from '../boards/entities/board.entity';
import { BoardColumn } from '../columns/entities/board-column.entity';
import { Card } from './entities/card.entity';
import { ListCardsDto } from './dto/list-cards.dto';
import { CardResponseDto, toCardResponseDto } from './dto/card-response.dto';
import { CreateCardDto } from './dto/create-card.dto';
import { UpdateCardDto } from './dto/update-card.dto';
import { MoveCardDto } from './dto/move-card.dto';
import { AssignCardDto } from './dto/assign-card.dto';
import { CardAssignee } from './entities/card-assignee.entity';
import { BoardMember } from '../board-members/entities/board-member.entity';
import {
  CardAssigneeResponseDto,
  toCardAssigneeResponseDto,
} from './dto/card-assignee-response.dto';
import { resolveCardDates } from './card-dates';
import { cardInsertionPosition } from './cards-ordering';
import { rebalancePositions } from '../columns/columns-ordering';

@Injectable()
export class CardsService {
  constructor(
    @InjectRepository(Card) private readonly cards: Repository<Card>,
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    @InjectRepository(BoardColumn)
    private readonly columns: Repository<BoardColumn>,
    private readonly authorization: BoardAuthorizationService,
    private readonly events: BoardEventPublisher,
    private readonly activities: ActivityWriterService,
  ) {}

  async create(
    userId: string,
    boardId: string,
    input: CreateCardDto,
  ): Promise<CardResponseDto> {
    const result = await this.mutate(userId, boardId, async (manager) => {
      const column = await this.requireColumn(
        manager.getRepository(BoardColumn),
        boardId,
        input.columnId,
      );
      const cards = manager.getRepository(Card);
      const last = await cards.findOne({
        where: { boardId, columnId: column.id, isArchived: false },
        order: { position: 'DESC', id: 'DESC' },
      });
      const position = cardInsertionPosition(last?.position);
      const card = cards.create({
        boardId,
        columnId: column.id,
        createdById: userId,
        title: input.title,
        description: input.description ?? null,
        ...resolveCardDates(input),
        isArchived: false,
        archivedAt: null,
        position: position ?? '0.0000000000',
      });
      if (position) {
        const saved = await cards.save(card);
        await this.activities.record(manager, {
          boardId: saved.boardId,
          actorId: userId,
          actionType: ActivityActionType.CARD_CREATED,
          entityType: ActivityEntityType.CARD,
          entityId: saved.id,
          metadata: null,
        });
        return toCardResponseDto(saved);
      }
      const ordered = await cards.find({
        where: { boardId, columnId: column.id, isArchived: false },
        order: { position: 'ASC', id: 'ASC' },
      });
      const all = [...ordered, card];
      const positions = rebalancePositions(all.length);
      all.forEach((row, index) => {
        row.position = positions[index];
      });
      const saved = await cards.save(all);
      await this.activities.record(manager, {
        boardId: saved[saved.length - 1].boardId,
        actorId: userId,
        actionType: ActivityActionType.CARD_CREATED,
        entityType: ActivityEntityType.CARD,
        entityId: saved[saved.length - 1].id,
        metadata: null,
      });
      return toCardResponseDto(saved[saved.length - 1]);
    });
    await this.events.publish(RealtimeServerEvent.CARD_CREATED, {
      boardId: result.boardId,
      cardId: result.id,
      columnId: result.columnId,
    });
    return result;
  }

  async update(
    userId: string,
    boardId: string,
    cardId: string,
    input: UpdateCardDto,
  ): Promise<CardResponseDto> {
    if (
      input.title === undefined &&
      input.description === undefined &&
      input.startDate === undefined &&
      input.dueDate === undefined
    ) {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'At least one card field must be provided',
      );
    }
    let changed = false;
    const result = await this.mutate(userId, boardId, async (manager) => {
      const cards = manager.getRepository(Card);
      const card = await this.requireCard(cards, boardId, cardId, true);
      const { startDate, dueDate } = resolveCardDates(input, card);
      changed =
        (input.title !== undefined && input.title !== card.title) ||
        (input.description !== undefined &&
          input.description !== card.description) ||
        startDate?.getTime() !== card.startDate?.getTime() ||
        dueDate?.getTime() !== card.dueDate?.getTime();
      if (!changed) return toCardResponseDto(card);
      if (input.title !== undefined) card.title = input.title;
      if (input.description !== undefined) card.description = input.description;
      if (input.startDate !== undefined) card.startDate = startDate;
      if (input.dueDate !== undefined) card.dueDate = dueDate;
      const saved = await cards.save(card);
      await this.activities.record(manager, {
        boardId: saved.boardId,
        actorId: userId,
        actionType: ActivityActionType.CARD_UPDATED,
        entityType: ActivityEntityType.CARD,
        entityId: saved.id,
        metadata: null,
      });
      return toCardResponseDto(saved);
    });
    if (changed)
      await this.events.publish(RealtimeServerEvent.CARD_UPDATED, {
        boardId: result.boardId,
        cardId: result.id,
        columnId: result.columnId,
      });
    return result;
  }

  async archive(
    userId: string,
    boardId: string,
    cardId: string,
  ): Promise<CardResponseDto> {
    const result = await this.mutate(userId, boardId, async (manager) => {
      const cards = manager.getRepository(Card);
      const card = await this.requireCard(cards, boardId, cardId, true);
      card.isArchived = true;
      card.archivedAt = new Date();
      const saved = await cards.save(card);
      await this.activities.record(manager, {
        boardId: saved.boardId,
        actorId: userId,
        actionType: ActivityActionType.CARD_ARCHIVED,
        entityType: ActivityEntityType.CARD,
        entityId: saved.id,
        metadata: null,
      });
      return toCardResponseDto(saved);
    });
    await this.events.publish(RealtimeServerEvent.CARD_ARCHIVED, {
      boardId: result.boardId,
      cardId: result.id,
      columnId: result.columnId,
    });
    return result;
  }

  async restore(
    userId: string,
    boardId: string,
    cardId: string,
  ): Promise<CardResponseDto> {
    const result = await this.mutate(userId, boardId, async (manager) => {
      const cards = manager.getRepository(Card);
      const card = await this.requireCard(cards, boardId, cardId);
      if (!card.isArchived) {
        throw new ApplicationException(
          HttpStatus.CONFLICT,
          'CARD_NOT_ARCHIVED',
          'Card is already active',
        );
      }
      const column = await manager
        .getRepository(BoardColumn)
        .findOne({ where: { id: card.columnId, boardId } });
      if (!column) {
        throw new ApplicationException(
          HttpStatus.CONFLICT,
          'CARD_COLUMN_UNAVAILABLE',
          'The original card column is unavailable',
        );
      }
      const last = await cards.findOne({
        where: { boardId, columnId: column.id, isArchived: false },
        order: { position: 'DESC', id: 'DESC' },
      });
      const position = cardInsertionPosition(last?.position);
      if (position) {
        card.position = position;
      } else {
        const active = await cards.find({
          where: { boardId, columnId: column.id, isArchived: false },
          order: { position: 'ASC', id: 'ASC' },
        });
        const positions = rebalancePositions(active.length + 1);
        active.forEach((row, index) => {
          row.position = positions[index];
        });
        await cards.save(active);
        card.position = positions[active.length];
      }
      card.isArchived = false;
      card.archivedAt = null;
      const saved = await cards.save(card);
      await this.activities.record(manager, {
        boardId,
        actorId: userId,
        actionType: ActivityActionType.CARD_RESTORED,
        entityType: ActivityEntityType.CARD,
        entityId: saved.id,
        metadata: null,
      });
      return toCardResponseDto(saved);
    });
    await this.events.publish(RealtimeServerEvent.CARD_RESTORED, {
      boardId: result.boardId,
      cardId: result.id,
      columnId: result.columnId,
    });
    return result;
  }

  async move(
    userId: string,
    boardId: string,
    cardId: string,
    input: MoveCardDto,
  ): Promise<CardResponseDto> {
    let fromColumnId = '';
    let changed = false;
    const result = await this.mutate(userId, boardId, async (manager) => {
      const cards = manager.getRepository(Card);
      const moving = await this.requireCard(cards, boardId, cardId, true);
      fromColumnId = moving.columnId;
      const column = await this.requireColumn(
        manager.getRepository(BoardColumn),
        boardId,
        input.toColumnId,
      );
      const anchor = input.beforeCardId?.toLowerCase() ?? null;
      if (anchor === moving.id)
        throw new ApplicationException(
          HttpStatus.BAD_REQUEST,
          'INVALID_CARD_MOVE',
          'Card cannot be moved before itself',
        );
      const current = await cards.find({
        where: { boardId, columnId: column.id, isArchived: false },
        order: { position: 'ASC', id: 'ASC' },
      });
      const remaining = current.filter((card) => card.id !== moving.id);
      const targetIndex =
        anchor === null
          ? remaining.length
          : remaining.findIndex((card) => card.id === anchor);
      if (targetIndex < 0)
        throw new ApplicationException(
          HttpStatus.NOT_FOUND,
          'CARD_NOT_FOUND',
          'Card not found',
        );
      if (
        moving.columnId === column.id &&
        current.findIndex((card) => card.id === moving.id) === targetIndex
      )
        return toCardResponseDto(moving);
      changed = true;
      const recordMove = async (moved: Card) =>
        this.activities.record(manager, {
          boardId: moved.boardId,
          actorId: userId,
          actionType: ActivityActionType.CARD_MOVED,
          entityType: ActivityEntityType.CARD,
          entityId: moved.id,
          metadata: { fromColumnId, toColumnId: moved.columnId },
        });
      const position = cardInsertionPosition(
        remaining[targetIndex - 1]?.position,
        remaining[targetIndex]?.position,
      );
      moving.columnId = column.id;
      if (position) {
        moving.position = position;
        const saved = await cards.save(moving);
        await recordMove(saved);
        return toCardResponseDto(saved);
      }
      const ordered = [...remaining];
      ordered.splice(targetIndex, 0, moving);
      const positions = rebalancePositions(ordered.length);
      ordered.forEach((card, index) => {
        card.position = positions[index];
      });
      const saved = await cards.save(ordered);
      await recordMove(saved[targetIndex]);
      return toCardResponseDto(saved[targetIndex]);
    });
    if (changed)
      await this.events.publish(RealtimeServerEvent.CARD_MOVED, {
        boardId: result.boardId,
        cardId: result.id,
        fromColumnId,
        toColumnId: result.columnId,
      });
    return result;
  }

  async assign(
    userId: string,
    boardId: string,
    cardId: string,
    input: AssignCardDto,
  ): Promise<CardAssigneeResponseDto> {
    const result = await this.mutate(userId, boardId, async (manager) => {
      const card = await this.requireCard(
        manager.getRepository(Card),
        boardId,
        cardId,
        true,
      );
      const member = await manager
        .getRepository(BoardMember)
        .findOne({ where: { boardId, userId: input.userId } });
      if (!member)
        throw new ApplicationException(
          HttpStatus.NOT_FOUND,
          'BOARD_MEMBER_NOT_FOUND',
          'Board member not found',
        );
      const assignees = manager.getRepository(CardAssignee);
      const existing = await assignees.findOne({
        where: { cardId: card.id, userId: member.userId },
      });
      if (existing)
        throw new ApplicationException(
          HttpStatus.CONFLICT,
          'CARD_ASSIGNEE_EXISTS',
          'User is already assigned to this card',
        );
      const assignment = await assignees.save(
        assignees.create({
          cardId: card.id,
          userId: member.userId,
          assignedById: userId,
        }),
      );
      return {
        assignment: toCardAssigneeResponseDto(assignment),
        payload: {
          boardId: card.boardId,
          cardId: card.id,
          columnId: card.columnId,
        },
      };
    });
    await this.events.publish(
      RealtimeServerEvent.CARD_ASSIGNEES_CHANGED,
      result.payload,
    );
    return result.assignment;
  }

  async unassign(
    userId: string,
    boardId: string,
    cardId: string,
    targetUserId: string,
  ): Promise<void> {
    const payload = await this.mutate(userId, boardId, async (manager) => {
      const card = await this.requireCard(
        manager.getRepository(Card),
        boardId,
        cardId,
        true,
      );
      const result = await manager
        .getRepository(CardAssignee)
        .delete({ cardId: card.id, userId: targetUserId });
      if (!result.affected)
        throw new ApplicationException(
          HttpStatus.NOT_FOUND,
          'CARD_ASSIGNEE_NOT_FOUND',
          'Card assignee not found',
        );
      return {
        boardId: card.boardId,
        cardId: card.id,
        columnId: card.columnId,
      };
    });
    await this.events.publish(
      RealtimeServerEvent.CARD_ASSIGNEES_CHANGED,
      payload,
    );
  }

  private mutate<T>(
    userId: string,
    boardId: string,
    operation: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.boards.manager.transaction(async (manager) => {
      // Same first lock as E1 and member removal; no realtime queue is needed here.
      await this.authorization.requireMember(
        userId,
        boardId,
        { mutable: true },
        manager,
      );
      return operation(manager);
    });
  }

  async list(
    userId: string,
    boardId: string,
    query: ListCardsDto,
  ): Promise<PaginatedResponse<CardResponseDto>> {
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
    if (query.columnId)
      await this.requireColumn(this.columns, boardId, query.columnId);
    const builder = this.cards
      .createQueryBuilder('card')
      .leftJoinAndSelect('card.assignees', 'assignee')
      .where('card.boardId = :boardId', { boardId })
      .andWhere('card.isArchived = :isArchived', {
        isArchived: query.status === 'archived',
      });
    if (query.columnId) {
      builder.andWhere('card.columnId = :columnId', {
        columnId: query.columnId,
      });
    }
    if (query.status === 'archived') {
      builder.orderBy('card.archivedAt', 'DESC');
    } else if (query.columnId) {
      builder.orderBy('card.position', 'ASC');
    } else {
      builder
        .orderBy('card.columnId', 'ASC')
        .addOrderBy('card.position', 'ASC');
    }
    const [cards, total] = await builder
      .addOrderBy('card.id', query.status === 'archived' ? 'DESC' : 'ASC')
      .skip(offset)
      .take(query.limit)
      .getManyAndCount();
    return paginate(cards.map(toCardResponseDto), total, query);
  }

  async get(
    userId: string,
    boardId: string,
    cardId: string,
  ): Promise<CardResponseDto> {
    await this.authorization.requireRead(userId, boardId);
    return toCardResponseDto(
      await this.requireCard(this.cards, boardId, cardId),
    );
  }

  private async requireColumn(
    columns: Repository<BoardColumn>,
    boardId: string,
    columnId: string,
  ): Promise<BoardColumn> {
    const column = await columns.findOne({ where: { id: columnId, boardId } });
    if (!column)
      throw new ApplicationException(
        HttpStatus.NOT_FOUND,
        'COLUMN_NOT_FOUND',
        'Column not found',
      );
    return column;
  }

  private async requireCard(
    cards: Repository<Card>,
    boardId: string,
    cardId: string,
    mutable = false,
  ): Promise<Card> {
    const card = await cards.findOne({
      where: { id: cardId, boardId },
      relations: { assignees: true },
    });
    if (!card)
      throw new ApplicationException(
        HttpStatus.NOT_FOUND,
        'CARD_NOT_FOUND',
        'Card not found',
      );
    if (mutable && card.isArchived)
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'CARD_ARCHIVED',
        'Archived cards cannot be modified',
      );
    return card;
  }
}
