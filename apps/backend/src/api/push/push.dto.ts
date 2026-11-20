import { Expose } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import type {
  RegisterPushDevice,
  PushPreferences,
  CurrentPushDevice,
} from '@kanban/shared';
export class UpdatePushPreferencesDto {
  @IsBoolean() enabled!: boolean;
}
export class RegisterPushDeviceDto implements RegisterPushDevice {
  @IsUUID('4') installationId!: string;
  @IsString()
  @MaxLength(256)
  @Matches(/^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]{16,220}\]$/)
  expoPushToken!: string;
  @IsIn(['android', 'ios']) platform!: 'android' | 'ios';
  @IsIn(['development', 'preview', 'production']) appEnvironment!:
    'development' | 'preview' | 'production';
  @IsUUID('4') projectId!: string;
}
export class CurrentPushQueryDto {
  @IsUUID('4') installationId!: string;
}
export class PushPreferencesDto implements PushPreferences {
  @Expose() enabled!: boolean;
  @Expose() deliveryAvailable!: boolean;
}
export class CurrentPushDeviceDto implements CurrentPushDevice {
  @Expose() registered!: boolean;
  @Expose() eligible!: boolean;
}
export class RegisteredPushDeviceDto {
  @Expose() installationId!: string;
  @Expose() registered!: boolean;
}
