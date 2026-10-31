import { HttpStatus, Injectable } from '@nestjs/common';
import { RealtimeServerEvent } from '@kanban/shared';
import { BoardEventPublisher } from '../../realtime/board-event-publisher.service';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { Board } from '../boards/entities/board.entity';
import { ApplicationException } from '../../exceptions/application.exception';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import {
  paginate,
  pageOffset,
  PaginatedResponse,
} from '../../common/dto/paginated-response';
import { Card } from '../cards/entities/card.entity';
import { CardLabel } from '../cards/entities/card-label.entity';
import { toResponseDto } from '../../common/dto/to-response-dto';
import { BoardLabel } from './entities/board-label.entity';
import {
  CardLabelsResponseDto,
  LabelResponseDto,
  toLabelResponse,
} from './dto/label-response.dto';

export const MAX_BOARD_LABELS = 200;
interface Mutation<T> {
  value: T;
  changed: boolean;
  labelId: string;
  card?: Card;
}

@Injectable()
export class LabelsService {
  constructor(
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    private readonly authorization: BoardAuthorizationService,
    private readonly events: BoardEventPublisher,
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

  async cardLabels(
    userId: string,
    boardId: string,
    cardId: string,
  ): Promise<CardLabelsResponseDto> {
    return (await this.forCards(userId, boardId, [cardId]))[0];
  }

  /** Bounded, Board-scoped preview access: two queries independent of Card count. */
  async forCards(
    userId: string,
    boardId: string,
    cardIds: string[],
  ): Promise<CardLabelsResponseDto[]> {
    await this.authorization.requireRead(userId, boardId);
    if (cardIds.length > 100)
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'At most 100 Card IDs are supported',
      );
    const ids = [...new Set(cardIds.map((id) => id.toLowerCase()))];
    if (!ids.length) return [];
    const manager = this.boards.manager;
    const cards = await manager.getRepository(Card).find({
      where: { boardId, id: In(ids) },
      select: { id: true },
      take: 100,
    });
    if (cards.length !== ids.length)
      throw new ApplicationException(
        HttpStatus.NOT_FOUND,
        'CARD_NOT_FOUND',
        'Card not found',
      );
    return this.readCardLabels(manager, boardId, ids);
  }

  assign(
    userId: string,
    boardId: string,
    cardId: string,
    labelId: string,
  ): Promise<CardLabelsResponseDto> {
    return this.mutate(userId, boardId, async (manager, board) => {
      const card = await this.requireMutableCard(manager, board.id, cardId);
      const label = await this.requireLabel(manager, board.id, labelId);
      const links = manager.getRepository(CardLabel);
      if (
        await links.findOneBy({
          cardId: card.id,
          labelId: label.id,
          boardId: board.id,
        })
      )
        throw new ApplicationException(
          HttpStatus.CONFLICT,
          'CARD_LABEL_EXISTS',
          'Label is already assigned to this Card',
        );
      await links.save(
        links.create({ cardId: card.id, labelId: label.id, boardId: board.id }),
      );
      return {
        value: (await this.readCardLabels(manager, board.id, [card.id]))[0],
        changed: true,
        labelId: label.id,
        card,
      };
    });
  }

  unassign(
    userId: string,
    boardId: string,
    cardId: string,
    labelId: string,
  ): Promise<void> {
    return this.mutate(userId, boardId, async (manager, board) => {
      const card = await this.requireMutableCard(manager, board.id, cardId);
      const label = await this.requireLabel(manager, board.id, labelId);
      const result = await manager
        .getRepository(CardLabel)
        .delete({ cardId: card.id, labelId: label.id, boardId: board.id });
      if (!result.affected)
        throw new ApplicationException(
          HttpStatus.NOT_FOUND,
          'CARD_LABEL_NOT_FOUND',
          'Card label association not found',
        );
      return { value: undefined, changed: true, labelId: label.id, card };
    });
  }

  private async readCardLabels(
    manager: EntityManager,
    boardId: string,
    ids: string[],
  ): Promise<CardLabelsResponseDto[]> {
    const links = await manager
      .getRepository(CardLabel)
      .createQueryBuilder('link')
      .innerJoinAndSelect('link.label', 'label')
      .where('link.boardId = :boardId', { boardId })
      .andWhere('link.cardId IN (:...ids)', { ids })
      .orderBy('link.cardId', 'ASC')
      .addOrderBy('LOWER(label.name)', 'ASC')
      .addOrderBy('label.id', 'ASC')
      .limit(MAX_BOARD_LABELS * ids.length)
      .getMany();
    const grouped = new Map(ids.map((id) => [id, [] as LabelResponseDto[]]));
    for (const link of links)
      grouped.get(link.cardId)!.push(toLabelResponse(link.label));
    return ids.map((cardId) =>
      toResponseDto(CardLabelsResponseDto, {
        cardId,
        labels: grouped.get(cardId)!,
      }),
    );
  }

  private async requireMutableCard(
    manager: EntityManager,
    boardId: string,
    cardId: string,
  ): Promise<Card> {
    const card = await manager
      .getRepository(Card)
      .findOneBy({ id: cardId, boardId });
    if (!card)
      throw new ApplicationException(
        HttpStatus.NOT_FOUND,
        'CARD_NOT_FOUND',
        'Card not found',
      );
    if (card.isArchived)
      throw new ApplicationException(
        HttpStatus.CONFLICT,
        'CARD_ARCHIVED',
        'Archived cards cannot be modified',
      );
    return card;
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
      return { ...(await operation(manager, board)), boardId: board.id };
    });
    // The Board database lock is released before entering the delivery coordinator.
    if (result.changed) {
      if (result.card)
        await this.events.publish(RealtimeServerEvent.CARD_UPDATED, {
          boardId: result.boardId,
          cardId: result.card.id,
          columnId: result.card.columnId,
        });
      else
        await this.events.publish(RealtimeServerEvent.LABELS_CHANGED, {
          boardId: result.boardId,
          labelId: result.labelId,
        });
    }
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
