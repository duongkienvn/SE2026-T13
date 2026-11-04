import { HttpStatus, Injectable } from '@nestjs/common';
import { NotificationKind, RealtimeServerEvent } from '@kanban/shared';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
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
import { BoardEventPublisher } from '../../realtime/board-event-publisher.service';
import { BoardMember } from '../board-members/entities/board-member.entity';
import { CommentMention } from './entities/comment-mention.entity';
import { CommentMentionDto } from './dto/comment-mention.dto';
import { NotificationService } from '../notifications/notification.service';
import { NotificationEventPublisher } from '../../realtime/notification-event-publisher.service';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly comments: Repository<Comment>,
    @InjectRepository(Card) private readonly cards: Repository<Card>,
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    private readonly authorization: BoardAuthorizationService,
    private readonly activities: ActivityWriterService,
    private readonly events: BoardEventPublisher,
    private readonly notifications: NotificationService,
    private readonly notificationEvents: NotificationEventPublisher,
  ) {}

  async list(
    userId: string,
    boardId: string,
    cardId: string,
    query: PageQuery,
  ): Promise<PaginatedResponse<CommentResponseDto>> {
    await this.authorization.requireRead(userId, boardId);
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
    const access = await this.authorization.requireRead(userId, boardId);
    const mentions =
      access.member && comments.length
        ? await this.comments.manager.getRepository(CommentMention).find({
            where: { commentId: In(comments.map((comment) => comment.id)) },
            order: { start: 'ASC' },
          })
        : [];
    const currentAccess = await this.authorization.requireRead(userId, boardId);
    return paginate(
      comments.map((comment) =>
        toCommentResponseDto(
          comment,
          currentAccess.member
            ? mentions
                .filter((mention) => mention.commentId === comment.id)
                .map(({ userId, start, end }) => ({ userId, start, end }))
            : [],
        ),
      ),
      total,
      query,
    );
  }

  async create(
    userId: string,
    boardId: string,
    cardId: string,
    input: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    const result = await this.mutate(userId, boardId, async (manager) => {
      const card = await this.requireCard(
        manager.getRepository(Card),
        boardId,
        cardId,
        true,
      );
      const comments = manager.getRepository(Comment);
      const comment = comments.create({
        cardId: card.id,
        authorId: userId,
        content: input.content,
      });
      const saved = await comments.save(comment);
      const mentions = await this.replaceMentions(
        manager,
        boardId,
        saved,
        input.mentions ?? [],
      );
      const notified = await this.notifyMentions(
        manager,
        boardId,
        saved,
        [],
        mentions,
      );
      await this.activities.record(manager, {
        boardId,
        actorId: userId,
        actionType: ActivityActionType.COMMENT_CREATED,
        entityType: ActivityEntityType.COMMENT,
        entityId: saved.id,
        metadata: { cardId: card.id },
      });
      return { comment: toCommentResponseDto(saved, mentions), notified };
    });
    await this.notificationEvents.afterCommit(result.notified);
    await this.events.publish(RealtimeServerEvent.COMMENT_CREATED, {
      boardId,
      cardId: result.comment.cardId,
      commentId: result.comment.id,
    });
    return result.comment;
  }

  async update(
    userId: string,
    boardId: string,
    cardId: string,
    commentId: string,
    input: UpdateCommentDto,
  ): Promise<CommentResponseDto> {
    const { result, changed, notified } = await this.mutate(
      userId,
      boardId,
      async (manager) => {
        await this.requireCard(
          manager.getRepository(Card),
          boardId,
          cardId,
          true,
        );
        const comments = manager.getRepository(Comment);
        const comment = await this.requireComment(comments, cardId, commentId);
        this.requireAuthor(comment, userId);
        const existing = await manager
          .getRepository(CommentMention)
          .find({ where: { commentId }, order: { start: 'ASC' } });
        if (comment.content === input.content && input.mentions === undefined)
          return {
            result: toCommentResponseDto(comment, existing),
            changed: false,
            notified: [],
          };
        const contentChanged = comment.content !== input.content;
        comment.content = input.content;
        const saved = await comments.save(comment);
        const mentions = await this.replaceMentions(
          manager,
          boardId,
          saved,
          input.mentions ?? [],
        );
        const notified = await this.notifyMentions(
          manager,
          boardId,
          saved,
          existing,
          mentions,
        );
        await this.activities.record(manager, {
          boardId,
          actorId: userId,
          actionType: ActivityActionType.COMMENT_UPDATED,
          entityType: ActivityEntityType.COMMENT,
          entityId: saved.id,
          metadata: null,
        });
        return {
          result: toCommentResponseDto(saved, mentions),
          changed: contentChanged || input.mentions !== undefined,
          notified,
        };
      },
    );
    await this.notificationEvents.afterCommit(notified);
    if (changed)
      await this.events.publish(RealtimeServerEvent.COMMENT_UPDATED, {
        boardId,
        cardId: result.cardId,
        commentId: result.id,
      });
    return result;
  }

  private async replaceMentions(
    manager: EntityManager,
    boardId: string,
    comment: Comment,
    spans: CommentMentionDto[],
  ): Promise<CommentMentionDto[]> {
    const invalid = () =>
      new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Invalid comment mentions',
      );
    const ordered = [...spans].sort((a, b) => a.start - b.start);
    if (
      ordered.length > 20 ||
      new Set(ordered.map((span) => span.userId.toLowerCase())).size > 10
    )
      throw invalid();
    const members = ordered.length
      ? await manager.getRepository(BoardMember).find({
          where: {
            boardId,
            userId: In(ordered.map((span) => span.userId.toLowerCase())),
          },
          relations: { user: true },
        })
      : [];
    const names = new Map(
      members.map((member) => [member.userId, member.user.displayName]),
    );
    let end = 0;
    for (const span of ordered) {
      const id = span.userId.toLowerCase();
      const split = (offset: number) =>
        offset > 0 &&
        offset < comment.content.length &&
        /[\uD800-\uDBFF]/.test(comment.content[offset - 1]) &&
        /[\uDC00-\uDFFF]/.test(comment.content[offset]);
      if (
        !Number.isInteger(span.start) ||
        !Number.isInteger(span.end) ||
        span.start < end ||
        span.start < 0 ||
        span.end > comment.content.length ||
        span.end <= span.start ||
        split(span.start) ||
        split(span.end) ||
        !names.has(id) ||
        comment.content.slice(span.start, span.end) !== `@${names.get(id)}`
      )
        throw invalid();
      end = span.end;
    }
    const repository = manager.getRepository(CommentMention);
    await repository.delete({ commentId: comment.id });
    if (ordered.length)
      await repository.save(
        ordered.map((span) =>
          repository.create({
            commentId: comment.id,
            userId: span.userId.toLowerCase(),
            start: span.start,
            end: span.end,
          }),
        ),
      );
    return ordered.map(({ userId, start, end }) => ({
      userId: userId.toLowerCase(),
      start,
      end,
    }));
  }

  private async notifyMentions(
    manager: EntityManager,
    boardId: string,
    comment: Comment,
    previous: CommentMentionDto[],
    current: CommentMentionDto[],
  ): Promise<string[]> {
    const old = new Set(previous.map((span) => span.userId));
    const recipients = [...new Set(current.map((span) => span.userId))].filter(
      (id) => id !== comment.authorId && !old.has(id),
    );
    const results = await this.notifications.recordMany(
      manager,
      recipients.map((recipientUserId) => ({
        kind: NotificationKind.COMMENT_MENTIONED,
        recipientUserId,
        actorUserId: comment.authorId,
        boardId,
        cardId: comment.cardId,
        occurrenceKey: `${comment.id}:${recipientUserId}`,
      })),
    );
    return results
      .filter((result) => result.status === 'created')
      .map((result) => result.recipientUserId);
  }

  async remove(
    userId: string,
    boardId: string,
    cardId: string,
    commentId: string,
  ): Promise<void> {
    const payload = await this.mutate(userId, boardId, async (manager) => {
      const card = await this.requireCard(
        manager.getRepository(Card),
        boardId,
        cardId,
        true,
      );
      const comments = manager.getRepository(Comment);
      const comment = await this.requireComment(comments, cardId, commentId);
      this.requireAuthor(comment, userId);
      await comments.softRemove(comment);
      await this.activities.record(manager, {
        boardId,
        actorId: userId,
        actionType: ActivityActionType.COMMENT_DELETED,
        entityType: ActivityEntityType.COMMENT,
        entityId: comment.id,
        metadata: null,
      });
      return { boardId, cardId: card.id, commentId: comment.id };
    });
    await this.events.publish(RealtimeServerEvent.COMMENT_DELETED, payload);
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
