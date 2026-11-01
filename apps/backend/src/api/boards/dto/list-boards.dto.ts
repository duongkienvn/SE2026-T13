import { IsIn, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  BooleanFieldOptional,
  StringFieldOptional,
} from '../../../decorators/field.decorators';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export class ListBoardsDto extends PageQueryDto {
  @IsIn(['active', 'archived'])
  status: 'active' | 'archived' = 'active';

  @StringFieldOptional({ trim: true, minLength: 0, maxLength: 120 })
  q?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsIn(['createdAt', 'updatedAt', 'name', 'recent'])
  @ApiPropertyOptional({ enum: ['createdAt', 'updatedAt', 'name', 'recent'] })
  sort?: 'createdAt' | 'updatedAt' | 'name' | 'recent';

  @BooleanFieldOptional() starred?: boolean;
  @BooleanFieldOptional() recent?: boolean;
}
