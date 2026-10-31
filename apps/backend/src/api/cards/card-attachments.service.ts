import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RealtimeServerEvent } from '@kanban/shared';
import { isUUID } from 'class-validator';
import { EntityManager, Repository } from 'typeorm';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { Board } from '../boards/entities/board.entity';
import { Card } from './entities/card.entity';
import { CardAttachment } from './entities/card-attachment.entity';
import { BoardEventPublisher } from '../../realtime/board-event-publisher.service';
import { ApplicationException } from '../../exceptions/application.exception';
import {
  paginate,
  pageOffset,
  type PaginatedResponse,
} from '../../common/dto/paginated-response';
import {
  AttachmentResponseDto,
  toAttachmentResponse,
} from './dto/attachment-response.dto';
import {
  AttachmentListQueryDto,
  CreateAttachmentDto,
  UpdateAttachmentDto,
} from './dto/attachment-requests.dto';
import {
  attachmentDisplayName,
  attachmentValidation,
  normalizeAttachmentUrl,
} from './attachments/attachment-url';
import {
  ATTACHMENT_CARD_SLOT_LIMIT,
  attachmentQuotaUsage,
} from './attachments/attachment-policy';
import { attachmentFilesUnavailable } from './attachments/attachment-storage';

@Injectable()
export class CardAttachmentsService {
  constructor(
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    private readonly authorization: BoardAuthorizationService,
    private readonly events: BoardEventPublisher,
  ) {}

  async list(
    userId: string,
    boardId: string,
    cardId: string,
    query: AttachmentListQueryDto,
  ): Promise<PaginatedResponse<AttachmentResponseDto>> {
    await this.authorization.requireRead(userId, boardId);
    await this.requireCard(this.boards.manager, boardId, cardId);
    let offset: number;
    try {
      offset = pageOffset(query);
      if (query.limit > 100) throw new RangeError();
    } catch {
      return attachmentValidation('Invalid pagination');
    }
    const [rows, total] = await this.boards.manager
      .getRepository(CardAttachment)
      .createQueryBuilder('asset')
      .where('asset.boardId = :boardId', { boardId })
      .andWhere('asset.cardId = :cardId', { cardId })
      .andWhere('asset.state = :state', { state: 'ACTIVE' })
      .orderBy('asset.createdAt', 'DESC')
      .addOrderBy('asset.id', 'DESC')
      .skip(offset)
      .take(query.limit)
      .getManyAndCount();
    return paginate(rows.map(toAttachmentResponse), total, query);
  }

  async get(
    userId: string,
    boardId: string,
    cardId: string,
    attachmentId: string,
  ): Promise<AttachmentResponseDto> {
    await this.authorization.requireRead(userId, boardId);
    await this.requireCard(this.boards.manager, boardId, cardId);
    return toAttachmentResponse(
      await this.requireAttachment(
        this.boards.manager,
        boardId,
        cardId,
        attachmentId,
      ),
    );
  }

  create(
    userId: string,
    boardId: string,
    cardId: string,
    input: CreateAttachmentDto,
    idempotencyKey?: string,
  ): Promise<AttachmentResponseDto> {
    return this.mutate(userId, boardId, cardId, async (manager, card) => {
      if (input.kind === 'FILE') return attachmentFilesUnavailable();
      if (input.kind !== 'URL')
        return attachmentValidation('Unsupported attachment kind');
      const url = normalizeAttachmentUrl(input.url);
      const displayName = attachmentDisplayName(input.displayName, url);
      const key = this.idempotencyKey(idempotencyKey);
      const requestHash = key
        ? createHash('sha256')
            .update(JSON.stringify({ kind: 'URL', url, displayName }))
            .digest('hex')
        : null;
      const repository = manager.getRepository(CardAttachment);
      if (key) {
        const prior = await repository
          .createQueryBuilder('asset')
          .addSelect('asset.requestHash')
          .where({ cardId: card.id, uploaderId: userId, idempotencyKey: key })
          .getOne();
        if (prior) {
          if (prior.requestHash !== requestHash)
            throw new ApplicationException(
              409,
              'ATTACHMENT_IDEMPOTENCY_CONFLICT',
              'Idempotency key was used for another request',
            );
          if (prior.state !== 'ACTIVE')
            throw new ApplicationException(
              409,
              'ATTACHMENT_REMOVED',
              'The attachment was removed',
            );
          return { value: toAttachmentResponse(prior), changed: false };
        }
      }
      const usage = await attachmentQuotaUsage(manager, card.boardId, card.id);
      if (usage.cardSlots >= BigInt(ATTACHMENT_CARD_SLOT_LIMIT))
        throw new ApplicationException(
          409,
          'ATTACHMENT_LIMIT_REACHED',
          'Card attachment limit reached',
        );
      const row = repository.create({
        boardId: card.boardId,
        cardId: card.id,
        uploaderId: userId,
        kind: 'URL',
        state: 'ACTIVE',
        displayName,
        url,
        originalFilename: null,
        pendingKey: null,
        storageKey: null,
        requestedMimeType: null,
        reservedBytes: null,
        mimeType: null,
        byteSize: null,
        expiresAt: null,
        verifiedAt: null,
        idempotencyKey: key,
        requestHash,
        revision: 1,
      });
      return {
        value: toAttachmentResponse(await repository.save(row)),
        changed: true,
      };
    });
  }

  update(
    userId: string,
    boardId: string,
    cardId: string,
    attachmentId: string,
    input: UpdateAttachmentDto,
  ): Promise<AttachmentResponseDto> {
    return this.mutate(userId, boardId, cardId, async (manager) => {
      const row = await this.requireAttachment(
        manager,
        boardId,
        cardId,
        attachmentId,
      );
      if (row.state !== 'ACTIVE') return this.notFound();
      if (row.kind === 'FILE') return attachmentFilesUnavailable();
      this.checkRevision(row, input.expectedRevision);
      if (input.url === undefined && input.displayName === undefined)
        return attachmentValidation('At least one editable field is required');
      const url =
        input.url === undefined ? row.url! : normalizeAttachmentUrl(input.url);
      const displayName =
        input.displayName === undefined
          ? row.displayName
          : attachmentDisplayName(input.displayName, url);
      const changed = url !== row.url || displayName !== row.displayName;
      if (changed) {
        row.url = url;
        row.displayName = displayName;
        row.revision++;
        await manager.getRepository(CardAttachment).save(row);
      }
      return { value: toAttachmentResponse(row), changed };
    });
  }

  remove(
    userId: string,
    boardId: string,
    cardId: string,
    attachmentId: string,
    expectedRevision?: number,
  ): Promise<void> {
    return this.mutate(userId, boardId, cardId, async (manager) => {
      const row = await this.requireAttachment(
        manager,
        boardId,
        cardId,
        attachmentId,
      );
      if (row.kind === 'FILE') return attachmentFilesUnavailable();
      if (row.state === 'REMOVED') return { value: undefined, changed: false };
      if (expectedRevision !== undefined)
        this.checkRevision(row, expectedRevision);
      row.state = 'REMOVED';
      row.revision++;
      await manager.getRepository(CardAttachment).save(row);
      return { value: undefined, changed: true };
    });
  }

  async file(
    userId: string,
    boardId: string,
    cardId: string,
    attachmentId: string,
  ): Promise<never> {
    await this.authorization.requireRead(userId, boardId);
    await this.requireCard(this.boards.manager, boardId, cardId);
    const row = await this.requireAttachment(
      this.boards.manager,
      boardId,
      cardId,
      attachmentId,
    );
    if (row.kind !== 'FILE' || row.state !== 'ACTIVE') return this.notFound();
    return attachmentFilesUnavailable();
  }

  private async mutate<T>(
    userId: string,
    boardId: string,
    cardId: string,
    operation: (
      manager: EntityManager,
      card: Card,
    ) => Promise<{ value: T; changed: boolean }>,
  ): Promise<T> {
    const result = await this.boards.manager.transaction(async (manager) => {
      await this.authorization.requireMember(
        userId,
        boardId,
        { mutable: true },
        manager,
      );
      const card = await this.requireCard(manager, boardId, cardId, true);
      return {
        ...(await operation(manager, card)),
        payload: {
          boardId: card.boardId,
          cardId: card.id,
          columnId: card.columnId,
        },
      };
    });
    if (result.changed)
      await this.events.publish(
        RealtimeServerEvent.CARD_UPDATED,
        result.payload,
      );
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
    if (!card)
      throw new ApplicationException(404, 'CARD_NOT_FOUND', 'Card not found');
    if (mutable && card.isArchived)
      throw new ApplicationException(
        409,
        'CARD_ARCHIVED',
        'Archived cards cannot be modified',
      );
    return card;
  }
  private async requireAttachment(
    manager: EntityManager,
    boardId: string,
    cardId: string,
    id: string,
  ): Promise<CardAttachment> {
    const row = await manager
      .getRepository(CardAttachment)
      .findOne({ where: { id, boardId, cardId } });
    if (!row) return this.notFound();
    return row;
  }
  private checkRevision(row: CardAttachment, revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 1)
      return attachmentValidation('Expected a positive revision');
    if (row.revision !== revision)
      throw new ApplicationException(
        409,
        'ATTACHMENT_REVISION_CONFLICT',
        'Attachment changed; reload before retrying',
      );
  }
  private idempotencyKey(value: string | undefined): string | null {
    if (value === undefined) return null;
    if (typeof value !== 'string' || !isUUID(value, '4'))
      return attachmentValidation('Idempotency-Key must be a UUID v4');
    return value.toLowerCase();
  }
  private notFound(): never {
    throw new ApplicationException(
      404,
      'ATTACHMENT_NOT_FOUND',
      'Attachment not found',
    );
  }
}
