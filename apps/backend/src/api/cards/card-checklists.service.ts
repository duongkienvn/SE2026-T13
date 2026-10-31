import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ApplicationException } from '../../exceptions/application.exception';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { Board } from '../boards/entities/board.entity';
import { Card } from './entities/card.entity';
import { CardChecklist } from './entities/card-checklist.entity';
import { CardChecklistItem } from './entities/card-checklist-item.entity';
import { toResponseDto } from '../../common/dto/to-response-dto';
import {
  CardChecklistSummaryDto,
  CardChecklistsResponseDto,
  checklistProgress,
  ChecklistResponseDto,
  toChecklistResponse,
} from './dto/checklist-response.dto';
import { persistChecklistPosition } from './checklist-ordering';

export const MAX_CARD_CHECKLISTS = 50;
export const MAX_CHECKLIST_ITEMS = 200;
interface Mutation<T> {
  value: T;
  changed: boolean;
}

@Injectable()
export class CardChecklistsService {
  constructor(
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    private readonly authorization: BoardAuthorizationService,
  ) {}

  async list(
    userId: string,
    boardId: string,
    cardId: string,
  ): Promise<CardChecklistsResponseDto> {
    await this.authorization.requireRead(userId, boardId);
    await this.requireCard(this.boards.manager, boardId, cardId);
    const rows = await this.boards.manager.getRepository(CardChecklist).find({
      where: { cardId },
      relations: { items: true },
      order: {
        position: 'ASC',
        id: 'ASC',
        items: { position: 'ASC', id: 'ASC' },
      },
      take: MAX_CARD_CHECKLISTS,
    });
    const checklists = rows.map(toChecklistResponse);
    return toResponseDto(CardChecklistsResponseDto, {
      cardId: cardId.toLowerCase(),
      checklists,
      ...checklistProgress(
        checklists.reduce((sum, row) => sum + row.checkedItems, 0),
        checklists.reduce((sum, row) => sum + row.totalItems, 0),
      ),
    });
  }

  create(
    userId: string,
    boardId: string,
    cardId: string,
    input: { title: string },
  ): Promise<ChecklistResponseDto> {
    return this.mutate(userId, boardId, cardId, async (manager) => {
      const repository = manager.getRepository(CardChecklist);
      const rows = await this.orderedChecklists(manager, cardId);
      if (rows.length >= MAX_CARD_CHECKLISTS)
        this.limitExceeded('Card checklist limit reached');
      const row = repository.create({ cardId, title: input.title });
      const saved = await persistChecklistPosition(
        repository,
        rows,
        row,
        rows.length,
      );
      return { value: toChecklistResponse(saved), changed: true };
    });
  }

  rename(
    userId: string,
    boardId: string,
    cardId: string,
    checklistId: string,
    input: { title: string },
  ): Promise<ChecklistResponseDto> {
    return this.mutate(userId, boardId, cardId, async (manager) => {
      const row = await this.requireChecklist(manager, cardId, checklistId);
      const changed = row.title !== input.title;
      if (changed) {
        row.title = input.title;
        await manager.getRepository(CardChecklist).save(row);
      }
      return { value: toChecklistResponse(row), changed };
    });
  }

  move(
    userId: string,
    boardId: string,
    cardId: string,
    checklistId: string,
    beforeChecklistId: string | null,
  ): Promise<ChecklistResponseDto> {
    return this.mutate(userId, boardId, cardId, async (manager) => {
      const row = await this.requireChecklist(manager, cardId, checklistId);
      const rows = await this.orderedChecklists(manager, cardId);
      const { remaining, index, changed } = this.moveTarget(
        rows,
        row.id,
        beforeChecklistId,
      );
      if (changed)
        await persistChecklistPosition(
          manager.getRepository(CardChecklist),
          remaining,
          row,
          index,
        );
      return { value: toChecklistResponse(row), changed };
    });
  }

  remove(
    userId: string,
    boardId: string,
    cardId: string,
    checklistId: string,
  ): Promise<void> {
    return this.mutate(userId, boardId, cardId, async (manager) => {
      const row = await this.requireChecklist(manager, cardId, checklistId);
      await manager.getRepository(CardChecklist).delete({ id: row.id, cardId });
      return { value: undefined, changed: true };
    });
  }

  /** One grouped query for up to 100 explicitly scoped cards; no item hydration. */
  async summaries(
    userId: string,
    boardId: string,
    cardIds: string[],
  ): Promise<CardChecklistSummaryDto[]> {
    await this.authorization.requireRead(userId, boardId);
    if (cardIds.length > 100)
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'At most 100 card IDs are supported',
      );
    const ids = [...new Set(cardIds.map((id) => id.toLowerCase()))];
    if (!ids.length) return [];
    const rows = await this.boards.manager
      .getRepository(Card)
      .createQueryBuilder('card')
      .leftJoin(CardChecklist, 'checklist', 'checklist.cardId = card.id')
      .leftJoin(CardChecklistItem, 'item', 'item.checklistId = checklist.id')
      .select('card.id', 'cardId')
      .addSelect('COUNT(item.id)', 'totalItems')
      .addSelect('COUNT(item.id) FILTER (WHERE item.isChecked)', 'checkedItems')
      .where('card.boardId = :boardId', { boardId })
      .andWhere('card.id IN (:...ids)', { ids })
      .groupBy('card.id')
      .limit(100)
      .getRawMany<{
        cardId: string;
        checkedItems: string;
        totalItems: string;
      }>();
    if (rows.length !== ids.length)
      this.notFound('CARD_NOT_FOUND', 'Card not found');
    const byId = new Map(rows.map((row) => [row.cardId, row]));
    return ids.map((id) => {
      const row = byId.get(id)!;
      return toResponseDto(CardChecklistSummaryDto, {
        cardId: id,
        ...checklistProgress(Number(row.checkedItems), Number(row.totalItems)),
      });
    });
  }

  addItem(
    userId: string,
    boardId: string,
    cardId: string,
    checklistId: string,
    input: { text: string },
  ): Promise<ChecklistResponseDto> {
    return this.mutate(userId, boardId, cardId, async (manager) => {
      const checklist = await this.requireChecklist(
        manager,
        cardId,
        checklistId,
      );
      const rows = checklist.items;
      if (rows.length >= MAX_CHECKLIST_ITEMS)
        this.limitExceeded('Checklist item limit reached');
      const repository = manager.getRepository(CardChecklistItem);
      const item = repository.create({
        checklistId: checklist.id,
        text: input.text,
        isChecked: false,
      });
      await persistChecklistPosition(repository, rows, item, rows.length);
      return {
        value: toChecklistResponse(
          await this.requireChecklist(manager, cardId, checklist.id),
        ),
        changed: true,
      };
    });
  }

  updateItem(
    userId: string,
    boardId: string,
    cardId: string,
    checklistId: string,
    itemId: string,
    input: { text?: string; isChecked?: boolean },
  ): Promise<ChecklistResponseDto> {
    if (input.text === undefined && input.isChecked === undefined)
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'At least one item field must be provided',
      );
    return this.mutate(userId, boardId, cardId, async (manager) => {
      const checklist = await this.requireChecklist(
        manager,
        cardId,
        checklistId,
      );
      const item = this.requireItem(checklist, itemId);
      const changed =
        (input.text !== undefined && input.text !== item.text) ||
        (input.isChecked !== undefined && input.isChecked !== item.isChecked);
      if (changed) {
        if (input.text !== undefined) item.text = input.text;
        if (input.isChecked !== undefined) item.isChecked = input.isChecked;
        await manager.getRepository(CardChecklistItem).save(item);
      }
      return { value: toChecklistResponse(checklist), changed };
    });
  }

  moveItem(
    userId: string,
    boardId: string,
    cardId: string,
    checklistId: string,
    itemId: string,
    beforeItemId: string | null,
  ): Promise<ChecklistResponseDto> {
    return this.mutate(userId, boardId, cardId, async (manager) => {
      const checklist = await this.requireChecklist(
        manager,
        cardId,
        checklistId,
      );
      const item = this.requireItem(checklist, itemId);
      const { remaining, index, changed } = this.moveTarget(
        checklist.items,
        item.id,
        beforeItemId,
      );
      if (changed)
        await persistChecklistPosition(
          manager.getRepository(CardChecklistItem),
          remaining,
          item,
          index,
        );
      return {
        value: toChecklistResponse(
          await this.requireChecklist(manager, cardId, checklist.id),
        ),
        changed,
      };
    });
  }

  removeItem(
    userId: string,
    boardId: string,
    cardId: string,
    checklistId: string,
    itemId: string,
  ): Promise<void> {
    return this.mutate(userId, boardId, cardId, async (manager) => {
      const checklist = await this.requireChecklist(
        manager,
        cardId,
        checklistId,
      );
      const item = this.requireItem(checklist, itemId);
      await manager
        .getRepository(CardChecklistItem)
        .delete({ id: item.id, checklistId: checklist.id });
      return { value: undefined, changed: true };
    });
  }

  private requireItem(
    checklist: CardChecklist,
    itemId: string,
  ): CardChecklistItem {
    const item = checklist.items.find((row) => row.id === itemId.toLowerCase());
    if (!item)
      this.notFound('CHECKLIST_ITEM_NOT_FOUND', 'Checklist item not found');
    return item;
  }

  private async mutate<T>(
    userId: string,
    boardId: string,
    cardId: string,
    operation: (manager: EntityManager, card: Card) => Promise<Mutation<T>>,
  ): Promise<T> {
    const result = await this.boards.manager.transaction(async (manager) => {
      await this.authorization.requireMember(
        userId,
        boardId,
        { mutable: true },
        manager,
      );
      const card = await this.requireCard(manager, boardId, cardId, true);
      return operation(manager, card);
    });
    return result.value;
  }

  private async requireCard(
    manager: EntityManager,
    boardId: string,
    cardId: string,
    mutable = false,
  ): Promise<Card> {
    const card = await manager
      .getRepository(Card)
      .findOne({ where: { id: cardId, boardId } });
    if (!card) this.notFound('CARD_NOT_FOUND', 'Card not found');
    if (mutable && card.isArchived)
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'CARD_ARCHIVED',
        'Archived cards cannot be modified',
      );
    return card;
  }

  private async requireChecklist(
    manager: EntityManager,
    cardId: string,
    checklistId: string,
  ): Promise<CardChecklist> {
    const row = await manager
      .getRepository(CardChecklist)
      .findOne({
        where: { id: checklistId, cardId },
        relations: { items: true },
        order: { items: { position: 'ASC', id: 'ASC' } },
      });
    if (!row) this.notFound('CHECKLIST_NOT_FOUND', 'Checklist not found');
    return row;
  }

  private orderedChecklists(
    manager: EntityManager,
    cardId: string,
  ): Promise<CardChecklist[]> {
    return manager.getRepository(CardChecklist).find({
      where: { cardId },
      order: { position: 'ASC', id: 'ASC' },
      take: MAX_CARD_CHECKLISTS,
    });
  }

  private moveTarget<T extends { id: string }>(
    rows: T[],
    movingId: string,
    beforeId: string | null,
  ) {
    const anchor = beforeId?.toLowerCase() ?? null;
    if (anchor === movingId)
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'INVALID_CHECKLIST_MOVE',
        'Cannot move before itself',
      );
    const remaining = rows.filter((row) => row.id !== movingId);
    const index =
      anchor === null
        ? remaining.length
        : remaining.findIndex((row) => row.id === anchor);
    if (index < 0)
      this.notFound('CHECKLIST_ANCHOR_NOT_FOUND', 'Reorder anchor not found');
    return {
      remaining,
      index,
      changed: rows.findIndex((row) => row.id === movingId) !== index,
    };
  }

  private notFound(code: string, message: string): never {
    throw new ApplicationException(HttpStatus.NOT_FOUND, code, message);
  }
  private limitExceeded(message: string): never {
    throw new ApplicationException(
      HttpStatus.CONFLICT,
      'CHECKLIST_LIMIT_REACHED',
      message,
    );
  }
}
