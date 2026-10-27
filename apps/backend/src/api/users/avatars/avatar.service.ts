import {
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, LessThan } from 'typeorm';
import { BoardAuthorizationService } from '../../board-members/board-authorization.service';
import { EnvironmentConfig } from '../../../config/environment';
import { BoardMember } from '../../board-members/entities/board-member.entity';
import { toUserResponseDto, UserResponseDto } from '../dto/user-response.dto';
import { AvatarUpload } from '../entities/avatar-upload.entity';
import { User } from '../entities/user.entity';
import { AvatarImageService } from './avatar-image.service';
import { AvatarStorage, AvatarTarget } from './avatar-storage';
import {
  AVATAR_INTENT_MS,
  AVATAR_MAX_BYTES,
  avatarError,
} from './avatar.constants';

@Injectable()
export class AvatarService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private cleaning = false;
  private readonly logger = new Logger(AvatarService.name);
  constructor(
    private readonly source: DataSource,
    private readonly storage: AvatarStorage,
    private readonly images: AvatarImageService,
    private readonly config: ConfigService<EnvironmentConfig, true>,
    private readonly authorization: BoardAuthorizationService,
  ) {}

  onModuleInit() {
    if (
      this.storage.kind === 'disabled' ||
      this.config.get('NODE_ENV', { infer: true }) === 'test'
    )
      return;
    this.timer = setInterval(() => {
      void this.cleanup().catch(() =>
        this.logger.warn('Avatar cleanup will retry.'),
      );
    }, 5 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async createIntent(
    userId: string,
    input: { contentType: string; fileSize: number; expectedRevision: number },
  ): Promise<{ uploadId: string; expiresAt: string; upload: AvatarTarget }> {
    if (this.storage.kind === 'disabled')
      throw avatarError(
        503,
        'AVATAR_STORAGE_UNAVAILABLE',
        'Photo uploads are not configured.',
      );
    const now = new Date();
    const id = randomUUID();
    const prefix =
      this.config.get('AVATAR_S3_PREFIX', { infer: true }) ?? 'avatars/v1';
    const intent = await this.source.transaction(async (manager) => {
      const user = await this.lockUser(manager, userId);
      this.requireRevision(user, input.expectedRevision);
      const uploads = manager.getRepository(AvatarUpload);
      const recent = await uploads
        .createQueryBuilder('upload')
        .where('upload.userId = :userId', { userId })
        .andWhere('upload.createdAt > :since', {
          since: new Date(now.getTime() - 15 * 60_000),
        })
        .getCount();
      if (recent >= 10)
        throw avatarError(
          429,
          'AVATAR_RATE_LIMIT',
          'Too many photo uploads. Try again in 15 minutes.',
        );
      const count = await uploads
        .createQueryBuilder('upload')
        .where('upload.userId = :userId', { userId })
        .andWhere('upload.expiresAt > :now', { now })
        .andWhere("upload.state IN ('pending', 'processing')")
        .getCount();
      if (count >= 3)
        throw avatarError(
          429,
          'AVATAR_UPLOAD_LIMIT',
          'Too many pending photos. Wait a few minutes and try again.',
        );
      return uploads.save(
        uploads.create({
          id,
          userId,
          pendingKey: `${prefix}/pending/${userId}/${id}`,
          activeKey: `${prefix}/active/${userId}/${id}.webp`,
          contentType: input.contentType,
          fileSize: input.fileSize,
          baseRevision: user.avatarRevision,
          state: 'pending',
          createdAt: now,
          expiresAt: new Date(now.getTime() + AVATAR_INTENT_MS),
          nextCleanupAt: new Date(now.getTime() + 60 * 60_000),
        }),
      );
    });
    try {
      const upload = await this.storage.presign(
        intent.pendingKey,
        intent.contentType,
        intent.fileSize,
      );
      if (upload.kind === 'memory')
        upload.url = `/users/me/avatar/uploads/${id}/file`;
      return {
        uploadId: id,
        expiresAt: intent.expiresAt.toISOString(),
        upload,
      };
    } catch (error) {
      await this.source
        .getRepository(AvatarUpload)
        .update(id, { state: 'rejected' })
        .catch(() => undefined);
      throw error;
    }
  }

  async receiveLocal(
    userId: string,
    id: string,
    body: Buffer,
    mime: string,
  ): Promise<void> {
    if (this.storage.kind !== 'memory')
      throw avatarError(404, 'NOT_FOUND', 'Endpoint not found.');
    const intent = await this.source
      .getRepository(AvatarUpload)
      .findOne({ where: { id, userId } });
    if (!intent)
      throw avatarError(
        404,
        'AVATAR_UPLOAD_NOT_FOUND',
        'Photo upload not found.',
      );
    if (intent.state !== 'pending' || intent.expiresAt.getTime() <= Date.now())
      throw avatarError(
        409,
        'AVATAR_UPLOAD_EXPIRED',
        'Choose the photo again to start a new upload.',
      );
    if (mime !== intent.contentType || body.length !== intent.fileSize)
      throw avatarError(
        415,
        'AVATAR_MIME_MISMATCH',
        'The upload does not match the selected photo.',
      );
    await this.storage.put(intent.pendingKey, body, mime);
  }

  async complete(userId: string, id: string): Promise<UserResponseDto> {
    const claim = await this.source.transaction(async (manager) => {
      const user = await this.lockUser(manager, userId);
      const intent = await this.lockIntent(manager, userId, id);
      if (
        intent.state === 'completed' &&
        user.avatarObjectKey === intent.activeKey
      )
        return { intent, completed: toUserResponseDto(user) };
      if (intent.state !== 'pending')
        throw avatarError(
          409,
          'AVATAR_UPLOAD_UNAVAILABLE',
          'This upload is already processing or has been used. Choose the photo again.',
        );
      this.requireLive(intent, user);
      intent.state = 'processing';
      await manager.getRepository(AvatarUpload).save(intent);
      return { intent, completed: null };
    });
    if (claim.completed) return claim.completed;
    const intent = claim.intent;
    let activePutStarted = false;
    try {
      const object = await this.storage.get(
        intent.pendingKey,
        AVATAR_MAX_BYTES,
      );
      if (
        object.body.length !== intent.fileSize ||
        object.contentType !== intent.contentType
      )
        throw avatarError(
          415,
          'AVATAR_MIME_MISMATCH',
          'The uploaded file does not match the selected photo.',
        );
      const normalized = await this.images.normalize(
        object.body,
        intent.contentType,
      );
      activePutStarted = true;
      await this.storage.put(intent.activeKey, normalized, 'image/webp', true);
      const result = await this.source.transaction(async (manager) => {
        const user = await this.lockUser(manager, userId);
        const locked = await this.lockIntent(manager, userId, id);
        if (locked.state !== 'processing')
          throw avatarError(
            409,
            'AVATAR_UPLOAD_UNAVAILABLE',
            'This upload is no longer available.',
          );
        this.requireLive(locked, user);
        const oldKey = user.avatarObjectKey;
        user.avatarObjectKey = locked.activeKey;
        user.avatarUrl = null;
        user.avatarRevision++;
        await manager.getRepository(User).update(user.id, {
          avatarObjectKey: user.avatarObjectKey,
          avatarUrl: null,
          avatarRevision: user.avatarRevision,
        });
        locked.state = 'completed';
        await manager.getRepository(AvatarUpload).save(locked);
        if (oldKey)
          await manager
            .getRepository(AvatarUpload)
            .update(
              { userId, activeKey: oldKey },
              { nextCleanupAt: new Date() },
            );
        return toUserResponseDto(
          await manager.getRepository(User).findOneByOrFail({ id: userId }),
        );
      });
      await this.storage.delete(intent.pendingKey).catch(() => undefined);
      return result;
    } catch (error) {
      // Never delete an active object here: a lost DB acknowledgement might
      // follow a successful commit. Durable intent cleanup rechecks references.
      const retryable =
        !activePutStarted &&
        error instanceof HttpException &&
        error.getStatus() === 503;
      await this.source
        .getRepository(AvatarUpload)
        .update(
          { id, userId, state: 'processing' },
          { state: retryable ? 'pending' : 'rejected' },
        )
        .catch(() => undefined);
      throw error;
    }
  }

  async remove(
    userId: string,
    expectedRevision: number,
  ): Promise<UserResponseDto> {
    return this.source.transaction(async (manager) => {
      const user = await this.lockUser(manager, userId);
      if (
        user.avatarRevision > expectedRevision &&
        !user.avatarObjectKey &&
        !user.avatarUrl
      )
        return toUserResponseDto(user);
      this.requireRevision(user, expectedRevision);
      const oldKey = user.avatarObjectKey;
      user.avatarObjectKey = null;
      user.avatarUrl = null;
      user.avatarRevision++;
      await manager.getRepository(User).update(user.id, {
        avatarObjectKey: null,
        avatarUrl: null,
        avatarRevision: user.avatarRevision,
      });
      if (oldKey)
        await manager
          .getRepository(AvatarUpload)
          .update({ userId, activeKey: oldKey }, { nextCleanupAt: new Date() });
      return toUserResponseDto(
        await manager.getRepository(User).findOneByOrFail({ id: userId }),
      );
    });
  }

  async read(
    viewerId: string,
    userId: string,
    assetId: string,
  ): Promise<Buffer> {
    const first = await this.authorizedAvatar(viewerId, userId, assetId);
    const object = await this.storage.get(first.avatarObjectKey!, 1024 * 1024);
    // Recheck after IO; access removal/replacement must not reveal stale content.
    const current = await this.authorizedAvatar(viewerId, userId, assetId);
    if (
      current.avatarObjectKey !== first.avatarObjectKey ||
      object.contentType !== 'image/webp'
    )
      throw avatarError(404, 'AVATAR_NOT_FOUND', 'Photo not found.');
    return object.body;
  }

  private async authorizedAvatar(
    viewerId: string,
    userId: string,
    assetId: string,
  ): Promise<User> {
    if (viewerId !== userId) {
      // Both actual Board memberships are required; Workspace roles grant nothing.
      const shared = await this.source
        .getRepository(BoardMember)
        .createQueryBuilder('viewer')
        .innerJoin(
          BoardMember,
          'owner',
          'owner.boardId = viewer.boardId AND owner.userId = :userId',
          { userId },
        )
        .where('viewer.userId = :viewerId', { viewerId })
        .getOne();
      if (!shared)
        throw avatarError(404, 'AVATAR_NOT_FOUND', 'Photo not found.');
      await this.authorization.requireMember(viewerId, shared.boardId);
    }
    const user = await this.source
      .getRepository(User)
      .findOne({ where: { id: userId } });
    if (!user?.avatarObjectKey?.endsWith(`/${assetId}.webp`))
      throw avatarError(404, 'AVATAR_NOT_FOUND', 'Photo not found.');
    return user;
  }

  /** One bounded sweep; may also be called explicitly by isolated integration tests. */
  async cleanup(now = new Date()): Promise<number> {
    if (this.cleaning || this.storage.kind === 'disabled') return 0;
    this.cleaning = true;
    let cleaned = 0;
    try {
      const uploads = this.source.getRepository(AvatarUpload);
      const batch = await uploads.find({
        where: { expiresAt: LessThan(now), nextCleanupAt: LessThan(now) },
        order: { nextCleanupAt: 'ASC' },
        take: 50,
      });
      for (const item of batch) {
        const keys = await this.source.transaction(async (manager) => {
          const user = await this.lockUser(manager, item.userId);
          const intent = await this.lockIntent(manager, item.userId, item.id);
          if (intent.expiresAt >= now || intent.nextCleanupAt > now)
            return null;
          if (intent.state !== 'completed') intent.state = 'rejected';
          intent.nextCleanupAt = new Date(now.getTime() + 24 * 60 * 60_000);
          await manager.getRepository(AvatarUpload).save(intent);
          return {
            pending: intent.pendingKey,
            active:
              user.avatarObjectKey === intent.activeKey
                ? null
                : intent.activeKey,
          };
        });
        if (!keys) continue;
        try {
          await this.storage.delete(keys.pending);
          if (keys.active) await this.storage.delete(keys.active);
          if (
            keys.active &&
            item.expiresAt.getTime() + 7 * 24 * 60 * 60_000 < now.getTime()
          )
            await uploads.delete(item.id);
          cleaned++;
        } catch {
          await uploads.update(item.id, {
            nextCleanupAt: new Date(now.getTime() + 5 * 60_000),
          });
        }
      }
      return cleaned;
    } finally {
      this.cleaning = false;
    }
  }

  private async lockUser(
    manager: EntityManager,
    userId: string,
  ): Promise<User> {
    const user = await manager
      .getRepository(User)
      .findOne({ where: { id: userId }, lock: { mode: 'pessimistic_write' } });
    if (!user) throw avatarError(404, 'NOT_FOUND', 'User not found.');
    return user;
  }
  private async lockIntent(
    manager: EntityManager,
    userId: string,
    id: string,
  ): Promise<AvatarUpload> {
    const intent = await manager
      .getRepository(AvatarUpload)
      .findOne({ where: { id, userId }, lock: { mode: 'pessimistic_write' } });
    if (!intent)
      throw avatarError(
        404,
        'AVATAR_UPLOAD_NOT_FOUND',
        'Photo upload not found.',
      );
    return intent;
  }
  private requireRevision(user: User, expected: number) {
    if (user.avatarRevision !== expected)
      throw avatarError(
        409,
        'AVATAR_CHANGED',
        'Your photo changed. Refresh the profile before trying again.',
      );
  }
  private requireLive(intent: AvatarUpload, user: User) {
    if (intent.expiresAt.getTime() <= Date.now())
      throw avatarError(
        409,
        'AVATAR_UPLOAD_EXPIRED',
        'The upload expired. Choose the photo again.',
      );
    this.requireRevision(user, intent.baseRevision);
  }
}
