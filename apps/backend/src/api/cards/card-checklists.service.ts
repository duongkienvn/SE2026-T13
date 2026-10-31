import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ApplicationException } from '../../exceptions/application.exception';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { Board } from '../boards/entities/board.entity';
import { Card } from './entities/card.entity';
import { CardChecklist } from './entities/card-checklist.entity';
import {
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
  ): Promise<ChecklistResponseDto[]> {
    await this.authorization.requireRead(userId, boardId);
    await this.requireCard(this.boards.manager, boardId, cardId);
    const rows = await this.boards.manager.getRepository(CardChecklist).find({
      where: { cardId },
      order: { position: 'ASC', id: 'ASC' },
      take: MAX_CARD_CHECKLISTS,
    });
    return rows.map(toChecklistResponse);
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
      .findOne({ where: { id: checklistId, cardId } });
    if (!row) this.notFound('CHECKLIST_NOT_FOUND', 'Checklist not found');
    return row;
  }

  private orderedChecklists(
    manager: EntityManager,
    cardId: string,
  ): Promise<CardChecklist[]> {
    return manager
      .getRepository(CardChecklist)
      .find({
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
