import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { WorkspacePageQueryDto } from './workspace-page-query.dto';
import { StringFieldOptional } from '../../../decorators/field.decorators';

export class WorkspaceBoardsQueryDto extends WorkspacePageQueryDto {
  @IsIn(['active', 'archived'])
  @ApiPropertyOptional({ enum: ['active', 'archived'], default: 'active' })
  status: 'active' | 'archived' = 'active';

  @StringFieldOptional({ trim: true, minLength: 0, maxLength: 120 })
  @ApiPropertyOptional({ maxLength: 120 })
  search?: string;

  @IsIn(['createdAt', 'updatedAt', 'name'])
  @ApiPropertyOptional({
    enum: ['createdAt', 'updatedAt', 'name'],
    default: 'updatedAt',
  })
  sort: 'createdAt' | 'updatedAt' | 'name' = 'updatedAt';
}
