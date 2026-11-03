import type { NotificationPreferences } from '@kanban/shared';
import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { ClassFieldOptional } from '../../../decorators/field.decorators';
import { IsBoolean, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class InAppNotificationPreferencesDto {
  @Expose() @ApiProperty({ default: true }) cardAssigned!: boolean;
  @Expose() @ApiProperty({ default: true }) commentMentioned!: boolean;
  @Expose() @ApiProperty({ default: true }) workspaceInvited!: boolean;
  @Expose() @ApiProperty({ default: true }) boardInvited!: boolean;
  @Expose() @ApiProperty({ default: true }) membershipChanged!: boolean;
  @Expose() @ApiProperty({ default: true }) dueReminder!: boolean;
}
export class NotificationEmailPreferencesDto {
  @Expose() @ApiProperty({ default: false }) cardAssigned!: boolean;
  @Expose() @ApiProperty({ default: false }) commentMentioned!: boolean;
  @Expose() @ApiProperty({ default: false }) dueReminder!: boolean;
}
export class NotificationPreferencesDto implements NotificationPreferences {
  @Expose()
  @Type(() => InAppNotificationPreferencesDto)
  @ApiProperty({ type: InAppNotificationPreferencesDto })
  inApp!: InAppNotificationPreferencesDto;
  @Expose()
  @Type(() => NotificationEmailPreferencesDto)
  @ApiProperty({ type: NotificationEmailPreferencesDto })
  email!: NotificationEmailPreferencesDto;
}
// Strict booleans: do not accept the string-coercing query boolean decorator in bodies.
class UpdateEmailNotificationPreferencesDto {
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsBoolean()
  @ApiPropertyOptional()
  cardAssigned?: boolean;
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsBoolean()
  @ApiPropertyOptional()
  commentMentioned?: boolean;
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsBoolean()
  @ApiPropertyOptional()
  dueReminder?: boolean;
}
class UpdateInAppNotificationPreferencesDto extends UpdateEmailNotificationPreferencesDto {
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsBoolean()
  @ApiPropertyOptional()
  workspaceInvited?: boolean;
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsBoolean()
  @ApiPropertyOptional()
  boardInvited?: boolean;
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsBoolean()
  @ApiPropertyOptional()
  membershipChanged?: boolean;
}
export class UpdateNotificationPreferencesDto {
  @ClassFieldOptional(() => UpdateInAppNotificationPreferencesDto)
  inApp?: UpdateInAppNotificationPreferencesDto;
  @ClassFieldOptional(() => UpdateEmailNotificationPreferencesDto)
  email?: UpdateEmailNotificationPreferencesDto;
}
