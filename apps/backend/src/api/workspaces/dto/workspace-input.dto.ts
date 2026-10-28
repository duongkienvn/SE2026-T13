import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import {
  StringField,
  StringFieldOptional,
} from '../../../decorators/field.decorators';

export const WORKSPACE_ICONS = [
  'briefcase',
  'users',
  'code',
  'palette',
  'layers',
] as const;
export type WorkspaceIcon = (typeof WORKSPACE_ICONS)[number];

export class CreateWorkspaceDto {
  @StringField({ trim: true, minLength: 1, maxLength: 120 })
  @ApiProperty({ minLength: 1, maxLength: 120 })
  name!: string;

  @StringFieldOptional({
    trim: true,
    nullable: true,
    minLength: 0,
    maxLength: 2000,
  })
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  description?: string | null;

  @StringFieldOptional({ nullable: true, maxLength: 16 })
  @IsIn([...WORKSPACE_ICONS, null])
  @ApiPropertyOptional({ enum: WORKSPACE_ICONS, nullable: true, maxLength: 16 })
  icon?: WorkspaceIcon | null;
}

export class UpdateWorkspaceDto extends PartialType(CreateWorkspaceDto, {
  skipNullProperties: false,
}) {}
