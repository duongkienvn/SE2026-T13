import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { PushSchedule } from '@kanban/shared';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { ApplicationException } from '../../exceptions/application.exception';
import { User } from '../users/entities/user.entity';
import { UserPreferences } from '../users/entities/user-preferences.entity';
import { UserPushSchedule } from './entities/user-push-schedule.entity';
import { DEFAULT_PUSH_SCHEDULE } from './push-schedule-time';
import type { UpdatePushScheduleDto } from './push-schedule.dto';

@Injectable()
export class PushScheduleService {
  constructor(private readonly source: DataSource) {}
  private async projection(
    m: EntityManager,
    userId: string,
    row: UserPushSchedule | null,
  ): Promise<PushSchedule> {
    const prefs = await m.getRepository(UserPreferences).findOneBy({ userId });
    return {
      enabled: row?.enabled ?? DEFAULT_PUSH_SCHEDULE.enabled,
      startLocal: row?.startLocal ?? DEFAULT_PUSH_SCHEDULE.startLocal,
      endLocal: row?.endLocal ?? DEFAULT_PUSH_SCHEDULE.endLocal,
      timeZone: prefs?.timeZone ?? 'UTC',
    };
  }
  async get(userId: string): Promise<PushSchedule> {
    const row = await this.source
      .getRepository(UserPushSchedule)
      .findOneBy({ userId });
    return this.projection(this.source.manager, userId, row);
  }
  async update(
    session: AuthenticatedUser,
    input: UpdatePushScheduleDto,
  ): Promise<PushSchedule> {
    if (Object.values(input).every((v) => v === undefined))
      throw new ApplicationException(
        400,
        'VALIDATION_FAILED',
        'At least one schedule field is required',
      );
    return this.source.transaction(async (m) => {
      // Same parent lock as worker preparation, push opt-out and timezone writes.
      // User -> schedule. No device/job locks are acquired by schedule writes.
      const user = await m.getRepository(User).findOne({
        where: { id: session.userId },
        lock: { mode: 'for_no_key_update' },
      });
      if (
        !user ||
        user.deletedAt ||
        !user.emailVerifiedAt ||
        user.authVersion !== session.authVersion ||
        session.expiresAt <= Date.now()
      )
        throw new ApplicationException(401, 'UNAUTHORIZED', 'Unauthorized');
      const repo = m.getRepository(UserPushSchedule);
      const stored = await repo.findOneBy({ userId: session.userId });
      const current = await this.projection(m, session.userId, stored);
      const next = {
        enabled: input.enabled ?? current.enabled,
        startLocal: input.startLocal ?? current.startLocal,
        endLocal: input.endLocal ?? current.endLocal,
      };
      if (next.enabled && next.startLocal === next.endLocal)
        throw new ApplicationException(
          400,
          'VALIDATION_FAILED',
          'Start and end must differ when quiet hours are enabled',
        );
      // A default/no-op PATCH must not manufacture persistence or touch timestamps.
      if (
        next.enabled !== current.enabled ||
        next.startLocal !== current.startLocal ||
        next.endLocal !== current.endLocal
      )
        await repo.save(
          repo.create({ ...stored, userId: session.userId, ...next }),
        );
      return { ...next, timeZone: current.timeZone };
    });
  }
}
