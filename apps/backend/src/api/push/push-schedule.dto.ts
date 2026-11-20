import { Expose } from 'class-transformer';
import { IsBoolean, Matches, ValidateIf } from 'class-validator';
import type { PushSchedule, UpdatePushSchedule } from '@kanban/shared';
import { StringFieldOptional } from '../../decorators/field.decorators';
import { PUSH_LOCAL_TIME } from './push-schedule-time';

export class UpdatePushScheduleDto implements UpdatePushSchedule {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;
  @StringFieldOptional({ minLength: 5, maxLength: 5 })
  @Matches(PUSH_LOCAL_TIME)
  startLocal?: string;
  @StringFieldOptional({ minLength: 5, maxLength: 5 })
  @Matches(PUSH_LOCAL_TIME)
  endLocal?: string;
}
export class PushScheduleDto implements PushSchedule {
  @Expose() enabled!: boolean;
  @Expose() startLocal!: string;
  @Expose() endLocal!: string;
  @Expose() timeZone!: string;
}
