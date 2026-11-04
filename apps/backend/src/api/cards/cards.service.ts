import { HttpStatus, Injectable } from '@nestjs/common';
import { NotificationKind, RealtimeServerEvent } from '@kanban/shared';
import { NotificationService } from '../notifications/notification.service';
import { enqueueTaskEmail } from '../notifications/task-email-outbox';
import { NotificationEventPublisher } from '../../realtime/notification-event-publisher.service';
import { BoardEventPublisher } from '../../realtime/board-event-publisher.service';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { parseCardDateInstant } from '@kanban/shared';
import { BoardLabel } from '../labels/entities/board-label.entity';
import { UserPreferences } from '../users/entities/user-preferences.entity';
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
import { DuplicateCardDto } from './dto/duplicate-card.dto';
import { CardAssignee } from './entities/card-assignee.entity';
import { CardChecklist } from './entities/card-checklist.entity';
import { CardChecklistItem } from './entities/card-checklist-item.entity';
import { CardLabel } from './entities/card-label.entity';
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
    private readonly notifications: NotificationService,
    private readonly notificationEvents: NotificationEventPublisher,
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
      const saved = await this.appendCard(manager, userId, {
        boardId,
        columnId: column.id,
        createdById: userId,
        title: input.title,
        description: input.description ?? null,
        ...resolveCardDates(input),
      });
      return toCardResponseDto(saved);
    });
    await this.events.publish(RealtimeServerEvent.CARD_CREATED, {
      boardId: result.boardId,
      cardId: result.id,
      columnId: result.columnId,
    });
    return result;
  }

  /**
   * Same-board copy of an active card: title, description, dates, labels and
   * checklists (every item unchecked). Assignees, comments, activity and
   * attachments are never copied. Not idempotent, like create.
   */
  async duplicate(
    userId: string,
    boardId: string,
    cardId: string,
    input: DuplicateCardDto,
  ): Promise<CardResponseDto> {
    const result = await this.mutate(userId, boardId, async (manager) => {
      const source = await this.requireCard(
        manager.getRepository(Card),
        boardId,
        cardId,
        true,
      );
      const column = await this.requireColumn(
        manager.getRepository(BoardColumn),
        boardId,
        input.columnId ?? source.columnId,
      );
      const saved = await this.appendCard(manager, userId, {
        boardId,
        columnId: column.id,
        createdById: userId,
        title: source.title,
        description: source.description,
        startDate: source.startDate,
        dueDate: source.dueDate,
      });
      // The board lock serializes this with label deletion and checklist edits.
      const labels = await manager
        .getRepository(CardLabel)
        .find({ where: { cardId: source.id, boardId } });
      if (labels.length > 0)
        await manager.getRepository(CardLabel).insert(
          labels.map((label) => ({
            cardId: saved.id,
            labelId: label.labelId,
            boardId,
          })),
        );
      const checklists = manager.getRepository(CardChecklist);
      const items = manager.getRepository(CardChecklistItem);
      const sourceChecklists = await checklists.find({
        where: { cardId: source.id },
        relations: { items: true },
        order: { position: 'ASC', id: 'ASC', items: { position: 'ASC' } },
      });
      for (const checklist of sourceChecklists) {
        const copy = await checklists.save(
          checklists.create({
            cardId: saved.id,
            title: checklist.title,
            position: checklist.position,
          }),
        );
        if (checklist.items.length > 0)
          await items.insert(
            checklist.items.map((item) => ({
              checklistId: copy.id,
              text: item.text,
              position: item.position,
              isChecked: false,
            })),
          );
      }
      return toCardResponseDto(saved);
    });
    await this.events.publish(RealtimeServerEvent.CARD_CREATED, {
      boardId: result.boardId,
      cardId: result.id,
      columnId: result.columnId,
    });
    return result;
  }

  /** Appends a new card to its column and records its creation. */
  private async appendCard(
    manager: EntityManager,
    userId: string,
    values: Pick<
      Card,
      | 'boardId'
      | 'columnId'
      | 'createdById'
      | 'title'
      | 'description'
      | 'startDate'
      | 'dueDate'
    >,
  ): Promise<Card> {
    const { boardId, columnId } = values;
    const cards = manager.getRepository(Card);
    const last = await cards.findOne({
      where: { boardId, columnId, isArchived: false },
      order: { position: 'DESC', id: 'DESC' },
    });
    const position = cardInsertionPosition(last?.position);
    const card = cards.create({
      ...values,
      isArchived: false,
      archivedAt: null,
      position: position ?? '0.0000000000',
    });
    let saved: Card;
    if (position) {
      saved = await cards.save(card);
    } else {
      const ordered = await cards.find({
        where: { boardId, columnId, isArchived: false },
        order: { position: 'ASC', id: 'ASC' },
      });
      const all = [...ordered, card];
      const positions = rebalancePositions(all.length);
      all.forEach((row, index) => {
        row.position = positions[index];
      });
      const rows = await cards.save(all);
      saved = rows[rows.length - 1];
    }
    await this.activities.record(manager, {
      boardId: saved.boardId,
      actorId: userId,
      actionType: ActivityActionType.CARD_CREATED,
      entityType: ActivityEntityType.CARD,
      entityId: saved.id,
      metadata: null,
    });
    return saved;
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
      const notification =
        member.userId === userId
          ? null
          : await this.notifications.record(manager, {
              kind: NotificationKind.CARD_ASSIGNED,
              recipientUserId: member.userId,
              actorUserId: userId,
              cardId: card.id,
              boardId,
              occurrenceKey: assignment.id,
            });
      if (member.userId !== userId) {
        await enqueueTaskEmail(manager, {
          recipientUserId: member.userId,
          kind: NotificationKind.CARD_ASSIGNED,
          occurrenceKey: assignment.id,
          boardId,
          cardId: card.id,
        });
      }
      return {
        notified:
          notification?.status === 'created'
            ? [notification.recipientUserId]
            : [],
        assignment: toCardAssigneeResponseDto(assignment),
        payload: {
          boardId: card.boardId,
          cardId: card.id,
          columnId: card.columnId,
        },
      };
    });
    await this.notificationEvents.afterCommit(result.notified);
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
    const manager = this.cards.manager;
    for (const [ids, entity, field] of [
      [query.labelIds, BoardLabel, 'id'],
      [query.assigneeIds, BoardMember, 'userId'],
    ] as const) {
      if (ids?.length) {
        const count = await manager.getRepository(entity).count({
          where: { boardId, [field]: In(ids) },
        });
        if (count !== ids.length)
          throw new ApplicationException(
            HttpStatus.NOT_FOUND,
            'NOT_FOUND',
            'Filter value not found',
          );
      }
    }
    let from: Date | undefined, to: Date | undefined;
    try {
      from = query.dueFrom ? parseCardDateInstant(query.dueFrom) : undefined;
      to = query.dueTo ? parseCardDateInstant(query.dueTo) : undefined;
      if (from && to && from >= to) throw new Error();
    } catch {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Invalid due date range',
      );
    }
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
    if (query.q) {
      const term = query.q.replace(/[\\%_]/g, '\\$&');
      builder.andWhere(
        "(card.title ILIKE :term ESCAPE '\\' OR card.description ILIKE :term ESCAPE '\\')",
        { term: `%${term}%` },
      );
    }
    if (query.labelIds?.length)
      builder.andWhere(
        'EXISTS (SELECT 1 FROM card_labels cl WHERE cl.card_id = card.id AND cl.board_id = :boardId AND cl.label_id IN (:...labelIds))',
        { labelIds: query.labelIds },
      );
    if (query.assigneeIds?.length)
      builder.andWhere(
        'EXISTS (SELECT 1 FROM card_assignees ca WHERE ca.card_id = card.id AND ca.user_id IN (:...assigneeIds))',
        { assigneeIds: query.assigneeIds },
      );
    if (from) builder.andWhere('card.dueDate >= :dueFrom', { dueFrom: from });
    if (to) builder.andWhere('card.dueDate < :dueTo', { dueTo: to });
    if (query.dueStatus === 'NO_DUE_DATE')
      builder.andWhere('card.dueDate IS NULL');
    else if (query.dueStatus) {
      const now = new Date();
      if (query.dueStatus === 'OVERDUE')
        builder.andWhere('card.dueDate < :now', { now });
      else {
        const zone =
          (await manager.getRepository(UserPreferences).findOneBy({ userId }))
            ?.timeZone ?? 'UTC';
        builder.andWhere('card.dueDate >= :now', { now });
        builder.andWhere(
          `(card.dueDate AT TIME ZONE :zone)::date ${query.dueStatus === 'DUE_TODAY' ? '=' : '<>'} (CAST(:now AS timestamptz) AT TIME ZONE :zone)::date`,
          { zone },
        );
      }
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
    await this.authorization.requireRead(userId, boardId);
    return paginate(cards.map(toCardResponseDto), total, query);
  }

  async previewSummaries(
    userId: string,
    boardId: string,
    cardIds: string[],
  ): Promise<{
    summaries: {
      cardId: string;
      labelIds: string[];
      checklist: { checkedItems: number; totalItems: number };
      attachmentCount: number;
      commentCount: number;
    }[];
  }> {
    await this.authorization.requireRead(userId, boardId);
    const rows: {
      cardId: string;
      labelIds: string[];
      checkedItems: number;
      totalItems: number;
      attachmentCount: number;
      commentCount: number;
    }[] = await this.cards.manager.query(
      `
      SELECT c.id AS "cardId",
        ARRAY(SELECT cl.label_id FROM card_labels cl WHERE cl.card_id = c.id AND cl.board_id = c.board_id ORDER BY cl.label_id) AS "labelIds",
        (SELECT count(*)::int FROM card_checklists ch JOIN card_checklist_items i ON i.checklist_id = ch.id WHERE ch.card_id = c.id AND i.is_checked) AS "checkedItems",
        (SELECT count(*)::int FROM card_checklists ch JOIN card_checklist_items i ON i.checklist_id = ch.id WHERE ch.card_id = c.id) AS "totalItems",
        (SELECT count(*)::int FROM card_attachments a WHERE a.card_id = c.id AND a.board_id = c.board_id AND a.state = 'ACTIVE') AS "attachmentCount",
        (SELECT count(*)::int FROM comments co WHERE co.card_id = c.id AND co.deleted_at IS NULL) AS "commentCount"
      FROM cards c WHERE c.board_id = $1 AND c.id = ANY($2::uuid[]) AND NOT c.is_archived ORDER BY c.id`,
      [boardId, cardIds],
    );
    await this.authorization.requireRead(userId, boardId);
    return {
      summaries: rows.map(({ checkedItems, totalItems, ...row }) => ({
        ...row,
        checklist: { checkedItems, totalItems },
      })),
    };
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
