import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { WorkspacePageQueryDto } from './workspace-page-query.dto';
import {
  BooleanFieldOptional,
  StringFieldOptional,
} from '../../../decorators/field.decorators';

export class WorkspaceBoardsQueryDto extends WorkspacePageQueryDto {
  @IsIn(['active', 'archived'])
  @ApiPropertyOptional({ enum: ['active', 'archived'], default: 'active' })
  status: 'active' | 'archived' = 'active';

  @StringFieldOptional({ trim: true, minLength: 0, maxLength: 120 })
  @ApiPropertyOptional({ maxLength: 120 })
  search?: string;

  @StringFieldOptional({ trim: true, minLength: 0, maxLength: 120 })
  q?: string;

  @BooleanFieldOptional() starred?: boolean;
  @BooleanFieldOptional() recent?: boolean;

  @IsIn(['createdAt', 'updatedAt', 'name', 'recent'])
  @ApiPropertyOptional({
    enum: ['createdAt', 'updatedAt', 'name', 'recent'],
    default: 'updatedAt',
  })
  sort: 'createdAt' | 'updatedAt' | 'name' | 'recent' = 'updatedAt';
}
