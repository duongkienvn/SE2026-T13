import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationPreference } from './entities/notification-preference.entity';
import {
  NotificationPreferencesDto,
  UpdateNotificationPreferencesDto,
} from './dto/notification-preferences.dto';
import {
  EMAIL_PREFERENCE_COLUMNS,
  IN_APP_PREFERENCE_COLUMNS,
  lockNotificationRecipient,
  toNotificationPreferences,
} from './notification-preferences';
import { ApplicationException } from '../../exceptions/application.exception';

@Injectable()
export class NotificationPreferencesService {
  constructor(
    @InjectRepository(NotificationPreference)
    private readonly preferences: Repository<NotificationPreference>,
  ) {}

  async get(userId: string): Promise<NotificationPreferencesDto> {
    return toNotificationPreferences(
      await this.preferences.findOneBy({ userId }),
    );
  }

  async update(
    userId: string,
    input: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesDto> {
    const leaves = [
      ...Object.values(input.inApp ?? {}),
      ...Object.values(input.email ?? {}),
    ].filter((value) => typeof value === 'boolean');
    if (!leaves.length)
      throw new ApplicationException(
        400,
        'VALIDATION_FAILED',
        'At least one notification preference is required',
      );
    return this.preferences.manager.transaction(async (manager) => {
      if (!(await lockNotificationRecipient(manager, userId)))
        throw new ApplicationException(404, 'NOT_FOUND', 'User not found');
      const repository = manager.getRepository(NotificationPreference);
      const row =
        (await repository.findOneBy({ userId })) ??
        repository.create({ userId });
      for (const [key, column] of Object.entries(IN_APP_PREFERENCE_COLUMNS)) {
        const value =
          input.inApp?.[key as keyof typeof IN_APP_PREFERENCE_COLUMNS];
        if (value !== undefined) row[column] = value;
      }
      for (const [key, column] of Object.entries(EMAIL_PREFERENCE_COLUMNS)) {
        const value =
          input.email?.[key as keyof typeof EMAIL_PREFERENCE_COLUMNS];
        if (value !== undefined) row[column] = value;
      }
      return toNotificationPreferences(await repository.save(row));
    });
  }
}
