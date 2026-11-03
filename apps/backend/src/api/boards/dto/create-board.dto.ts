import {
  StringField,
  StringFieldOptional,
  UUIDFieldOptional,
} from '../../../decorators/field.decorators';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, ValidateIf } from 'class-validator';
import type { BoardBackgroundPresetId } from '@kanban/shared';
import { BOARD_BACKGROUND_IDS } from '../board-backgrounds';

export class CreateBoardDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(BOARD_BACKGROUND_IDS)
  @ApiPropertyOptional({ enum: BOARD_BACKGROUND_IDS })
  backgroundPreset?: BoardBackgroundPresetId;

  @UUIDFieldOptional()
  workspaceId?: string;

  @StringField({ trim: true, minLength: 1, maxLength: 120 })
  @ApiProperty({ minLength: 1, maxLength: 120 })
  name!: string;

  @StringFieldOptional({ nullable: true, minLength: 0, maxLength: 2000 })
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  description?: string | null;
}
