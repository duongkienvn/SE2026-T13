import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsTimeZone, Matches, ValidateIf } from 'class-validator';
import {
  EnumFieldOptional,
  StringFieldOptional,
} from '../../../decorators/field.decorators';
import {
  PreferenceDateFormat,
  PreferenceTheme,
  PreferenceWeekStart,
} from '../user-preferences.constants';
import type { UserPreferencesResponseDto } from './user-preferences-response.dto';

export class UpdateUserPreferencesDto {
  @ValidateIf(
    (input: UpdateUserPreferencesDto, value: unknown) =>
      value !== undefined ||
      [input.timeZone, input.dateFormat, input.weekStartsOn].every(
        (field) => field === undefined,
      ),
  )
  @IsEnum(PreferenceTheme)
  @ApiPropertyOptional({
    enum: PreferenceTheme,
    description: 'At least one of the four preference fields is required.',
  })
  theme?: UserPreferencesResponseDto['theme'];

  @StringFieldOptional({ maxLength: 100, example: 'Asia/Ho_Chi_Minh' })
  // Intl also accepts numeric offsets on newer Node versions; require a named zone.
  @Matches(/^[A-Za-z][A-Za-z0-9_+\-/]*$/)
  @IsTimeZone()
  timeZone?: string;

  @EnumFieldOptional(PreferenceDateFormat)
  dateFormat?: UserPreferencesResponseDto['dateFormat'];

  @EnumFieldOptional(PreferenceWeekStart)
  weekStartsOn?: UserPreferencesResponseDto['weekStartsOn'];
}
