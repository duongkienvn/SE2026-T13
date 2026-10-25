import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import {
  PreferenceDateFormat,
  PreferenceTheme,
  PreferenceWeekStart,
} from '../user-preferences.constants';

export class UserPreferencesResponseDto {
  @Expose()
  @ApiProperty({ enum: PreferenceTheme, default: 'system' })
  theme!: (typeof PreferenceTheme)[keyof typeof PreferenceTheme];

  @Expose()
  @ApiProperty({ example: 'Asia/Ho_Chi_Minh', default: 'UTC', maxLength: 100 })
  timeZone!: string;

  @Expose()
  @ApiProperty({ enum: PreferenceDateFormat, default: 'YYYY-MM-DD' })
  dateFormat!: (typeof PreferenceDateFormat)[keyof typeof PreferenceDateFormat];

  @Expose()
  @ApiProperty({ enum: PreferenceWeekStart, default: 'monday' })
  weekStartsOn!: (typeof PreferenceWeekStart)[keyof typeof PreferenceWeekStart];
}
