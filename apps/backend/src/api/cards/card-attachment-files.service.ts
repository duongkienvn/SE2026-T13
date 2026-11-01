import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { RealtimeServerEvent } from '@kanban/shared';
import { isUUID } from 'class-validator';
import { EntityManager, Repository } from 'typeorm';
import type { EnvironmentConfig } from '../../config/environment';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { BoardEventPublisher } from '../../realtime/board-event-publisher.service';
import { Board } from '../boards/entities/board.entity';
import { User } from '../users/entities/user.entity';
import { Card } from './entities/card.entity';
import { CardAttachment } from './entities/card-attachment.entity';
import { toResponseDto } from '../../common/dto/to-response-dto';
import {
  toAttachmentResponse,
  AttachmentResponseDto,
} from './dto/attachment-response.dto';
import {
  CreateAttachmentUploadDto,
  AttachmentUploadResponseDto,
} from './dto/attachment-upload.dto';
import {
  AttachmentStorage,
  attachmentFilesUnavailable,
  type AttachmentStoredObject,
} from './attachments/attachment-storage';
import {
  MemoryAttachmentStorage,
  collectAttachmentBytes,
} from './attachments/attachment-storage-drivers';
import { AttachmentContentService } from './attachments/attachment-content.service';
import {
  ATTACHMENT_FILE_POLICY as POLICY,
  validateAttachmentDeclaration,
  fileError,
  type AttachmentMime,
} from './attachments/attachment-file-policy';
import { attachmentDisplayName } from './attachments/attachment-url';
import { attachmentQuotaUsage } from './attachments/attachment-policy';

const hidden = [
  'pendingKey',
  'storageKey',
  'requestedMimeType',
  'reservedBytes',
  'declaredBytes',
  'expiresAt',
  'verifiedAt',
  'contentSha256',
  'verificationToken',
  'verificationExpiresAt',
  'intentAuthVersion',
  'requestHash',
  'idempotencyKey',
].map((field) => `asset.${field}`);
type Actor = AuthenticatedUser;

@Injectable()
export class CardAttachmentFilesService {
  private processing = 0;
  constructor(
    @InjectRepository(Board) private readonly boards: Repository<Board>,
    private readonly authorization: BoardAuthorizationService,
    private readonly storage: AttachmentStorage,
    private readonly content: AttachmentContentService,
    private readonly events: BoardEventPublisher,
    private readonly config: ConfigService<EnvironmentConfig, true>,
  ) {}

  async createIntent(
    actor: Actor,
    boardId: string,
    cardId: string,
    input: CreateAttachmentUploadDto,
    key?: string,
  ): Promise<AttachmentUploadResponseDto> {
    const row = await this.write(
      actor,
      boardId,
      cardId,
      async (manager, card) => {
        this.available();
        const declared = validateAttachmentDeclaration(
          input.filename,
          input.contentType,
          input.fileSize,
        );
        const displayName = attachmentDisplayName(
          input.displayName === undefined
            ? declared.filename.slice(0, 120)
            : input.displayName,
          'https://attachment.invalid',
        );
        if (key !== undefined && !isUUID(key, '4'))
          throw fileError(
            400,
            'VALIDATION_FAILED',
            'Idempotency-Key must be a UUID v4',
          );
        const normalizedKey = key?.toLowerCase() ?? null;
        const requestHash = normalizedKey
          ? createHash('sha256')
              .update(
                JSON.stringify({
                  kind: 'FILE',
                  filename: declared.filename,
                  contentType: declared.mime,
                  fileSize: declared.size,
                  displayName,
                }),
              )
              .digest('hex')
          : null;
        const repository = manager.getRepository(CardAttachment);
        if (normalizedKey) {
          const prior = await repository
            .createQueryBuilder('asset')
            .addSelect(hidden)
            .where({
              cardId: card.id,
              uploaderId: actor.userId,
              idempotencyKey: normalizedKey,
            })
            .getOne();
          if (prior) {
            if (prior.kind !== 'FILE' || prior.requestHash !== requestHash)
              throw fileError(
                409,
                'ATTACHMENT_IDEMPOTENCY_CONFLICT',
                'Idempotency key was used for another request',
              );
            if (prior.state === 'ACTIVE') return prior;
            this.pending(prior, actor);
            this.notBusy(prior);
            return prior;
          }
        }
        const usage = await attachmentQuotaUsage(
          manager,
          card.boardId,
          card.id,
        );
        if (
          usage.cardSlots >= BigInt(POLICY.maximumCardAttachments) ||
          usage.boardFileBytes + BigInt(declared.reservedBytes) >
            BigInt(POLICY.maximumBoardFileBytes)
        )
          throw fileError(
            409,
            'ATTACHMENT_LIMIT_REACHED',
            'Attachment quota reached',
          );
        const id = randomUUID();
        return repository.save(
          repository.create({
            id,
            cardId: card.id,
            boardId: card.boardId,
            uploaderId: actor.userId,
            kind: 'FILE',
            state: 'PENDING',
            displayName,
            url: null,
            originalFilename: declared.filename,
            pendingKey: `attachments/v1/pending/${id}`,
            storageKey: `attachments/v1/active/${id}`,
            requestedMimeType: declared.mime,
            reservedBytes: String(declared.reservedBytes),
            declaredBytes: String(declared.size),
            mimeType: null,
            byteSize: null,
            verifiedAt: null,
            contentSha256: null,
            intentAuthVersion: actor.authVersion,
            verificationToken: null,
            verificationExpiresAt: null,
            idempotencyKey: normalizedKey,
            requestHash,
            expiresAt: new Date(Date.now() + POLICY.intentMilliseconds),
            revision: 1,
          }),
        );
      },
    );
    if (row.state === 'ACTIVE') return this.intentResponse(row, null);
    // No provider calls occur while any business transaction is open.
    const grant = await this.storage.createUploadGrant({
      pendingKey: row.pendingKey!,
      mimeType: row.requestedMimeType!,
      byteSize: Number(row.declaredBytes),
      expiresAt: row.expiresAt!,
    });
    return this.write(actor, boardId, cardId, async (manager) => {
      const current = await this.asset(manager, boardId, cardId, row.id);
      if (current.state === 'ACTIVE') return this.intentResponse(current, null);
      this.pending(current, actor);
      this.notBusy(current);
      if (grant.expiresAt.getTime() <= Date.now())
        throw fileError(
          409,
          'ATTACHMENT_UPLOAD_EXPIRED',
          'Upload grant expired; retry the intent',
        );
      const prefix = this.config.get('API_PREFIX', { infer: true }) ?? 'api';
      return this.intentResponse(current, {
        kind: grant.kind,
        url:
          grant.kind === 'memory'
            ? `/${prefix}/boards/${current.boardId}/cards/${current.cardId}/attachments/uploads/${current.id}/file`
            : grant.url,
        fields: { ...grant.fields },
        expiresAt: grant.expiresAt.toISOString(),
      });
    });
  }

  async complete(
    actor: Actor,
    boardId: string,
    cardId: string,
    id: string,
  ): Promise<AttachmentResponseDto> {
    let acquired = false,
      ticket: CardAttachment | undefined;
    try {
      const claim = await this.write(
        actor,
        boardId,
        cardId,
        async (manager, card) => {
          const row = await this.asset(manager, boardId, cardId, id);
          this.owner(row, actor);
          if (row.state === 'ACTIVE')
            return { active: toAttachmentResponse(row), card, row };
          this.available();
          this.pending(row, actor);
          this.notBusy(row);
          if (this.processing >= POLICY.maximumCompletions)
            throw fileError(
              503,
              'ATTACHMENT_PROCESSOR_BUSY',
              'Attachment processing is busy',
            );
          acquired = true;
          this.processing++;
          row.verificationToken = randomUUID();
          row.verificationExpiresAt = new Date(
            Math.min(
              row.expiresAt!.getTime(),
              Date.now() + POLICY.verificationMilliseconds,
            ),
          );
          row.revision++;
          await manager.getRepository(CardAttachment).update(
            { id: row.id },
            {
              verificationToken: row.verificationToken,
              verificationExpiresAt: row.verificationExpiresAt,
              revision: row.revision,
            },
          );
          return { row, card };
        },
      );
      if (claim.active) return claim.active;
      ticket = claim.row;
      let object: AttachmentStoredObject;
      try {
        object = await this.storage.read(
          ticket.pendingKey!,
          Number(ticket.declaredBytes),
        );
      } catch (error) {
        if (this.code(error) === 'ATTACHMENT_OBJECT_NOT_FOUND') {
          await this.clearClaim(ticket, false);
          throw fileError(
            409,
            'ATTACHMENT_NOT_UPLOADED',
            'Upload bytes before completing',
          );
        }
        throw error;
      }
      if (object.contentType !== ticket.requestedMimeType) {
        object.cancel?.();
        throw fileError(
          415,
          'ATTACHMENT_TYPE_MISMATCH',
          'Stored MIME does not match the intent',
        );
      }
      const raw = await collectAttachmentBytes(
        object,
        Number(ticket.declaredBytes),
      );
      if (raw.length !== Number(ticket.declaredBytes))
        throw fileError(
          422,
          'ATTACHMENT_SIZE_MISMATCH',
          'Upload size does not match the intent',
        );
      const verified = await this.content.verify(
        raw,
        ticket.requestedMimeType as AttachmentMime,
        Number(ticket.reservedBytes),
      );
      const digest = createHash('sha256').update(verified).digest('hex');
      try {
        await this.storage.writeVerified({
          storageKey: ticket.storageKey!,
          body: Readable.from([verified]),
          mimeType: ticket.requestedMimeType!,
          byteSize: verified.length,
          ifAbsent: true,
        });
      } catch (error) {
        if (this.code(error) !== 'ATTACHMENT_OBJECT_EXISTS') throw error;
        const existing = await this.storage.read(
          ticket.storageKey!,
          Number(ticket.reservedBytes),
        );
        if (existing.contentType !== ticket.requestedMimeType) {
          existing.cancel?.();
          throw fileError(
            422,
            'ATTACHMENT_CONTENT_CONFLICT',
            'Verified object does not match this upload',
          );
        }
        const bytes = await collectAttachmentBytes(
          existing,
          Number(ticket.reservedBytes),
        );
        if (
          !timingSafeEqual(
            createHash('sha256').update(bytes).digest(),
            Buffer.from(digest, 'hex'),
          )
        )
          throw fileError(
            422,
            'ATTACHMENT_CONTENT_CONFLICT',
            'Verified object does not match this upload',
          );
      }
      const result = await this.write(
        actor,
        boardId,
        cardId,
        async (manager, card) => {
          const current = await this.asset(manager, boardId, cardId, id);
          this.owner(current, actor);
          if (current.state === 'ACTIVE') {
            if (current.contentSha256 !== digest)
              throw fileError(
                409,
                'ATTACHMENT_COMPLETION_CONFLICT',
                'Attachment was finalized by another operation',
              );
            return {
              value: toAttachmentResponse(current),
              changed: false,
              card,
            };
          }
          this.pending(current, actor);
          if (
            current.verificationToken !== ticket!.verificationToken ||
            !current.verificationExpiresAt ||
            current.verificationExpiresAt.getTime() <= Date.now()
          )
            throw fileError(
              409,
              'ATTACHMENT_COMPLETION_CONFLICT',
              'Verification lease expired or was superseded',
            );
          const usage = await attachmentQuotaUsage(
            manager,
            card.boardId,
            card.id,
          );
          if (
            usage.boardFileBytes -
              BigInt(current.reservedBytes!) +
              BigInt(verified.length) >
              BigInt(POLICY.maximumBoardFileBytes) ||
            usage.cardSlots > BigInt(POLICY.maximumCardAttachments)
          )
            throw fileError(
              409,
              'ATTACHMENT_LIMIT_REACHED',
              'Attachment quota reached',
            );
          current.state = 'ACTIVE';
          current.mimeType = current.requestedMimeType;
          current.byteSize = String(verified.length);
          current.contentSha256 = digest;
          current.verifiedAt = new Date();
          current.verificationToken = null;
          current.verificationExpiresAt = null;
          current.revision++;
          await manager.getRepository(CardAttachment).update(
            { id: current.id },
            {
              state: 'ACTIVE',
              mimeType: current.mimeType,
              byteSize: current.byteSize,
              contentSha256: current.contentSha256,
              verifiedAt: current.verifiedAt,
              verificationToken: null,
              verificationExpiresAt: null,
              revision: current.revision,
            },
          );
          const saved = await this.asset(manager, boardId, cardId, current.id);
          return { value: toAttachmentResponse(saved), changed: true, card };
        },
      );
      if (result.changed)
        await this.events.publish(RealtimeServerEvent.CARD_UPDATED, {
          boardId: result.card.boardId,
          cardId: result.card.id,
          columnId: result.card.columnId,
        });
      return result.value;
    } catch (error) {
      if (
        ticket &&
        error instanceof Error &&
        'getStatus' in error &&
        [400, 413, 415, 422].includes(
          (error as { getStatus(): number }).getStatus(),
        )
      )
        await this.clearClaim(ticket, true).catch(() => undefined);
      throw error;
    } finally {
      if (acquired) this.processing--;
    }
  }

  async checkLocalUpload(
    actor: Actor,
    boardId: string,
    cardId: string,
    id: string,
  ): Promise<CardAttachment> {
    if (this.storage.kind !== 'memory')
      throw fileError(404, 'NOT_FOUND', 'Endpoint not found');
    return this.write(actor, boardId, cardId, async (manager) => {
      const row = await this.asset(manager, boardId, cardId, id);
      this.pending(row, actor);
      this.notBusy(row);
      return row;
    });
  }
  async receiveLocal(
    actor: Actor,
    boardId: string,
    cardId: string,
    id: string,
    body: Buffer,
    mime: string,
  ): Promise<void> {
    const row = await this.checkLocalUpload(actor, boardId, cardId, id);
    if (!(this.storage instanceof MemoryAttachmentStorage))
      throw fileError(404, 'NOT_FOUND', 'Endpoint not found');
    if (mime !== row.requestedMimeType)
      throw fileError(
        415,
        'ATTACHMENT_TYPE_MISMATCH',
        'Upload MIME does not match the intent',
      );
    await this.storage.upload(
      {
        pendingKey: row.pendingKey!,
        mimeType: row.requestedMimeType!,
        byteSize: Number(row.declaredBytes),
        expiresAt: row.expiresAt!,
      },
      body,
    );
    await this.checkLocalUpload(actor, boardId, cardId, id);
  }
  async cancel(
    actor: Actor,
    boardId: string,
    cardId: string,
    id: string,
  ): Promise<void> {
    await this.write(actor, boardId, cardId, async (manager) => {
      const row = await this.asset(manager, boardId, cardId, id);
      this.owner(row, actor);
      if (row.state === 'REMOVED') return;
      if (row.state === 'ACTIVE')
        throw fileError(
          409,
          'ATTACHMENT_ALREADY_COMPLETED',
          'Remove completed attachments through the attachment endpoint',
        );
      row.state = 'REMOVED';
      row.verificationToken = null;
      row.verificationExpiresAt = null;
      row.revision++;
      await manager.getRepository(CardAttachment).update(
        { id: row.id },
        {
          state: row.state,
          verificationToken: null,
          verificationExpiresAt: null,
          revision: row.revision,
        },
      );
    });
  }

  async download(
    actor: Actor,
    boardId: string,
    cardId: string,
    id: string,
  ): Promise<{
    object: AttachmentStoredObject;
    metadata: AttachmentResponseDto;
  }> {
    await this.readAccess(actor, boardId, cardId);
    const row = await this.asset(this.boards.manager, boardId, cardId, id);
    if (row.state !== 'ACTIVE') return this.notFound();
    this.available();
    if (!row.contentSha256)
      throw fileError(
        503,
        'ATTACHMENT_NOT_VERIFIED',
        'Legacy file content is not verified',
      );
    let object: AttachmentStoredObject;
    try {
      object = await this.storage.read(row.storageKey!, Number(row.byteSize));
    } catch (error) {
      if (this.code(error) === 'ATTACHMENT_OBJECT_NOT_FOUND')
        throw fileError(
          503,
          'ATTACHMENT_STORAGE_UNAVAILABLE',
          'Verified attachment content is unavailable',
        );
      throw error;
    }
    try {
      await this.readAccess(actor, boardId, cardId);
      const current = await this.asset(
        this.boards.manager,
        boardId,
        cardId,
        id,
      );
      if (
        current.state !== 'ACTIVE' ||
        current.contentSha256 !== row.contentSha256 ||
        current.storageKey !== row.storageKey
      )
        return this.notFound();
      if (
        object.byteSize !== Number(current.byteSize) ||
        object.contentType !== current.mimeType
      )
        throw fileError(
          503,
          'ATTACHMENT_STORAGE_UNAVAILABLE',
          'Verified attachment content is unavailable',
        );
      return { object, metadata: toAttachmentResponse(current) };
    } catch (error) {
      object.cancel?.();
      throw error;
    }
  }

  private async session(actor: Actor, manager: EntityManager, locking = false) {
    if (!Number.isFinite(actor.expiresAt) || actor.expiresAt <= Date.now())
      throw fileError(401, 'UNAUTHORIZED', 'Unauthorized');
    const user = await manager.getRepository(User).findOne({
      where: { id: actor.userId },
      select: { id: true, authVersion: true },
      ...(locking ? { lock: { mode: 'pessimistic_read' as const } } : {}),
    });
    if (!user || user.authVersion !== actor.authVersion)
      throw fileError(401, 'UNAUTHORIZED', 'Unauthorized');
  }
  private async write<T>(
    actor: Actor,
    boardId: string,
    cardId: string,
    operation: (manager: EntityManager, card: Card) => Promise<T>,
  ): Promise<T> {
    return this.boards.manager.transaction(async (manager) => {
      await this.authorization.requireMember(
        actor.userId,
        boardId,
        { mutable: true },
        manager,
      );
      await this.session(actor, manager, true);
      const card = await this.card(manager, boardId, cardId);
      if (card.isArchived)
        throw fileError(
          409,
          'CARD_ARCHIVED',
          'Archived cards cannot be modified',
        );
      return operation(manager, card);
    });
  }
  private async readAccess(actor: Actor, boardId: string, cardId: string) {
    await this.session(actor, this.boards.manager);
    await this.authorization.requireRead(actor.userId, boardId);
    await this.card(this.boards.manager, boardId, cardId);
  }
  private async card(manager: EntityManager, boardId: string, id: string) {
    const row = await manager
      .getRepository(Card)
      .findOne({ where: { id, boardId } });
    if (!row) throw fileError(404, 'CARD_NOT_FOUND', 'Card not found');
    return row;
  }
  private async asset(
    manager: EntityManager,
    boardId: string,
    cardId: string,
    id: string,
  ) {
    const row = await manager
      .getRepository(CardAttachment)
      .createQueryBuilder('asset')
      .addSelect(hidden)
      .where({ id, boardId, cardId, kind: 'FILE' })
      .getOne();
    if (!row) return this.notFound();
    return row;
  }
  private owner(row: CardAttachment, actor: Actor) {
    if (row.uploaderId !== actor.userId) return this.notFound();
  }
  private pending(row: CardAttachment, actor: Actor) {
    this.owner(row, actor);
    if (
      row.state !== 'PENDING' ||
      !row.expiresAt ||
      row.expiresAt.getTime() <= Date.now()
    )
      throw fileError(
        409,
        'ATTACHMENT_UPLOAD_EXPIRED',
        'Upload intent is not pending or has expired',
      );
    if (row.intentAuthVersion !== actor.authVersion)
      throw fileError(
        409,
        'ATTACHMENT_UPLOAD_REVOKED',
        'Upload intent belongs to an invalidated session',
      );
  }
  private notBusy(row: CardAttachment) {
    if (
      row.verificationExpiresAt &&
      row.verificationExpiresAt.getTime() > Date.now()
    )
      throw fileError(
        409,
        'ATTACHMENT_UPLOAD_BUSY',
        'Verification is in progress; retry shortly',
      );
  }
  private available() {
    if (!this.storage.available) return attachmentFilesUnavailable();
  }
  private notFound(): never {
    throw fileError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found');
  }
  private code(error: unknown): string | undefined {
    if (error instanceof Error && 'getResponse' in error)
      return (
        (error as { getResponse(): unknown }).getResponse() as { code?: string }
      ).code;
    return undefined;
  }
  private intentResponse(
    row: CardAttachment,
    upload: AttachmentUploadResponseDto['upload'],
  ) {
    return toResponseDto(AttachmentUploadResponseDto, {
      uploadId: row.id,
      state: row.state,
      expiresAt: row.expiresAt!.toISOString(),
      upload,
    });
  }
  private async clearClaim(ticket: CardAttachment, failed: boolean) {
    await this.boards.manager.transaction(async (manager) => {
      const board = await manager.getRepository(Board).findOne({
        where: { id: ticket.boardId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!board) return;
      const row = await manager.getRepository(CardAttachment).findOne({
        where: { id: ticket.id },
        select: {
          id: true,
          kind: true,
          state: true,
          revision: true,
          verificationToken: true,
        },
      });
      if (
        !row ||
        row.state !== 'PENDING' ||
        row.verificationToken !== ticket.verificationToken
      )
        return;
      if (failed) row.state = 'FAILED';
      row.verificationToken = null;
      row.verificationExpiresAt = null;
      row.revision++;
      await manager.getRepository(CardAttachment).update(
        { id: row.id },
        {
          state: row.state,
          verificationToken: null,
          verificationExpiresAt: null,
          revision: row.revision,
        },
      );
    });
  }
}
