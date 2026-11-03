import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  paginate,
  pageOffset,
  type PaginatedResponse,
} from '../../common/dto/paginated-response';
import { ApplicationException } from '../../exceptions/application.exception';
import { readWorkspaceSnapshot } from '../workspaces/workspace-read';
import { UserNotification } from './entities/user-notification.entity';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { NotificationResolver } from './notification-resolver.service';
import { NotificationInvalidation } from './notification-invalidation';
import { lockNotificationRecipient } from './notification-preferences';

@Injectable()
export class NotificationInboxService {
  private readonly logger = new Logger(NotificationInboxService.name);
  constructor(
    @InjectRepository(UserNotification)
    private readonly notifications: Repository<UserNotification>,
    private readonly resolver: NotificationResolver,
    private readonly invalidation: NotificationInvalidation,
  ) {}

  async list(
    userId: string,
    query: ListNotificationsDto,
  ): Promise<PaginatedResponse<NotificationResponseDto>> {
    let offset: number;
    try {
      offset = pageOffset(query);
    } catch {
      throw new ApplicationException(
        400,
        'VALIDATION_FAILED',
        'Pagination offset must be a safe integer',
      );
    }
    return readWorkspaceSnapshot(
      this.notifications.manager,
      async (manager) => {
        const base = manager
          .getRepository(UserNotification)
          .createQueryBuilder('notification')
          .where('notification.recipientUserId=:userId', { userId });
        if (query.filter === 'unread')
          base.andWhere('notification.readAt IS NULL');
        const total = await base.getCount();
        const rows = await base
          .orderBy('notification.createdAt', 'DESC')
          .addOrderBy('notification.id', 'DESC')
          .offset(offset)
          .limit(query.limit)
          .getMany();
        return paginate(
          await this.resolver.resolve(manager, userId, rows),
          total,
          query,
        );
      },
    );
  }
  async unreadCount(userId: string) {
    return {
      count: await this.notifications.countBy({
        recipientUserId: userId,
        readAt: IsNull(),
      }),
    };
  }

  async read(userId: string, id: string): Promise<NotificationResponseDto> {
    const result = await readWorkspaceSnapshot(
      this.notifications.manager,
      async (manager) => {
        const repository = manager.getRepository(UserNotification);
        const updated = await repository
          .createQueryBuilder()
          .update()
          .set({ readAt: () => 'clock_timestamp()' })
          .where('id=:id AND recipient_user_id=:userId AND read_at IS NULL', {
            id,
            userId,
          })
          .execute();
        const row = await repository.findOneBy({ id, recipientUserId: userId });
        if (!row)
          throw new ApplicationException(
            404,
            'NOT_FOUND',
            'Notification not found',
          );
        return {
          value: (await this.resolver.resolve(manager, userId, [row]))[0],
          changed: (updated.affected ?? 0) > 0,
        };
      },
    );
    if (result.changed) await this.notify(userId);
    return result.value;
  }
  async readAll(userId: string) {
    const updatedCount = await this.notifications.manager.transaction(
      async (manager) => {
        if (!(await lockNotificationRecipient(manager, userId)))
          throw new ApplicationException(404, 'NOT_FOUND', 'User not found');
        const result = await manager
          .getRepository(UserNotification)
          .createQueryBuilder()
          .update()
          .set({ readAt: () => 'clock_timestamp()' })
          .where('recipient_user_id=:userId AND read_at IS NULL', { userId })
          .execute();
        return result.affected ?? 0;
      },
    );
    if (updatedCount) await this.notify(userId);
    return { updatedCount };
  }
  private async notify(userId: string) {
    try {
      await this.invalidation.afterCommit([userId]);
    } catch {
      this.logger.error('Notification invalidation delivery failed');
    }
  }
}
