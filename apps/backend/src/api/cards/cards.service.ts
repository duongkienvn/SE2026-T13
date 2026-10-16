import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApplicationException } from '../../exceptions/application.exception';
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

@Injectable()
export class CardsService {
  constructor(
    @InjectRepository(Card) private readonly cards: Repository<Card>,
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    @InjectRepository(BoardColumn)
    private readonly columns: Repository<BoardColumn>,
    private readonly authorization: BoardAuthorizationService,
  ) {}

  async list(
    userId: string,
    boardId: string,
    query: ListCardsDto,
  ): Promise<PaginatedResponse<CardResponseDto>> {
    await this.authorization.requireMember(userId, boardId);
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
      .andWhere('card.isArchived = :isArchived', { isArchived: false });
    if (query.columnId) {
      builder
        .andWhere('card.columnId = :columnId', { columnId: query.columnId })
        .orderBy('card.position', 'ASC');
    } else {
      builder
        .orderBy('card.columnId', 'ASC')
        .addOrderBy('card.position', 'ASC');
    }
    const [cards, total] = await builder
      .addOrderBy('card.id', 'ASC')
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
    await this.authorization.requireMember(userId, boardId);
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
