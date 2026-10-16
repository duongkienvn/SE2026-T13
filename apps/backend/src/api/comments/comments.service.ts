import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ApplicationException } from '../../exceptions/application.exception';
import {
  paginate,
  pageOffset,
  PaginatedResponse,
  type PageQuery,
} from '../../common/dto/paginated-response';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { Board } from '../boards/entities/board.entity';
import { Card } from '../cards/entities/card.entity';
import { Comment } from './entities/comment.entity';
import {
  CommentResponseDto,
  toCommentResponseDto,
} from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly comments: Repository<Comment>,
    @InjectRepository(Card) private readonly cards: Repository<Card>,
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    private readonly authorization: BoardAuthorizationService,
  ) {}

  async list(
    userId: string,
    boardId: string,
    cardId: string,
    query: PageQuery,
  ): Promise<PaginatedResponse<CommentResponseDto>> {
    await this.authorization.requireMember(userId, boardId);
    await this.requireCard(this.cards, boardId, cardId);
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
    const [comments, total] = await this.comments
      .createQueryBuilder('comment')
      .where('comment.cardId = :cardId', { cardId })
      .andWhere('comment.deletedAt IS NULL')
      .orderBy('comment.createdAt', 'ASC')
      .addOrderBy('comment.id', 'ASC')
      .skip(offset)
      .take(query.limit)
      .getManyAndCount();
    return paginate(comments.map(toCommentResponseDto), total, query);
  }

  async create(
    userId: string,
    boardId: string,
    cardId: string,
    input: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    return this.mutate(userId, boardId, async (manager) => {
      await this.requireCard(
        manager.getRepository(Card),
        boardId,
        cardId,
        true,
      );
      const comments = manager.getRepository(Comment);
      const comment = comments.create({
        cardId,
        authorId: userId,
        content: input.content,
      });
      return toCommentResponseDto(await comments.save(comment));
    });
  }

  async update(
    userId: string,
    boardId: string,
    cardId: string,
    commentId: string,
    input: UpdateCommentDto,
  ): Promise<CommentResponseDto> {
    return this.mutate(userId, boardId, async (manager) => {
      await this.requireCard(
        manager.getRepository(Card),
        boardId,
        cardId,
        true,
      );
      const comments = manager.getRepository(Comment);
      const comment = await this.requireComment(comments, cardId, commentId);
      this.requireAuthor(comment, userId);
      comment.content = input.content;
      return toCommentResponseDto(await comments.save(comment));
    });
  }

  async remove(
    userId: string,
    boardId: string,
    cardId: string,
    commentId: string,
  ): Promise<void> {
    return this.mutate(userId, boardId, async (manager) => {
      await this.requireCard(
        manager.getRepository(Card),
        boardId,
        cardId,
        true,
      );
      const comments = manager.getRepository(Comment);
      const comment = await this.requireComment(comments, cardId, commentId);
      this.requireAuthor(comment, userId);
      await comments.softRemove(comment);
    });
  }

  private mutate<T>(
    userId: string,
    boardId: string,
    operation: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.boards.manager.transaction(async (manager) => {
      await this.authorization.requireMember(
        userId,
        boardId,
        { mutable: true },
        manager,
      );
      return operation(manager);
    });
  }

  private async requireCard(
    cards: Repository<Card>,
    boardId: string,
    cardId: string,
    mutable = false,
  ): Promise<Card> {
    const card = await cards.findOne({ where: { id: cardId, boardId } });
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

  private async requireComment(
    comments: Repository<Comment>,
    cardId: string,
    commentId: string,
  ): Promise<Comment> {
    const comment = await comments.findOne({
      where: { id: commentId, cardId },
    });
    if (!comment)
      throw new ApplicationException(
        HttpStatus.NOT_FOUND,
        'COMMENT_NOT_FOUND',
        'Comment not found',
      );
    return comment;
  }

  private requireAuthor(comment: Comment, userId: string): void {
    if (comment.authorId !== userId)
      throw new ApplicationException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Only the comment author can perform this operation',
      );
  }
}
