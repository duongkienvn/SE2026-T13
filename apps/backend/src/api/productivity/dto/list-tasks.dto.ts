import { TaskGroup, isCardDateInstant, type TaskSort } from '@kanban/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
  Matches,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
import {
  DateFieldOptional,
  EnumFieldOptional,
  UUIDFieldOptional,
} from '../../../decorators/field.decorators';
import { csvIds } from '../../cards/dto/list-cards.dto';

export class ListTasksDto extends PageQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  declare page: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  declare limit: number;

  @EnumFieldOptional({ ALL: 'ALL', ...TaskGroup })
  @ApiPropertyOptional({
    enum: ['ALL', ...Object.values(TaskGroup)],
    default: 'ALL',
  })
  group: 'ALL' | TaskGroup = 'ALL';

  @UUIDFieldOptional() workspaceId?: string;
  @UUIDFieldOptional() boardId?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => csvIds(value))
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @ApiPropertyOptional({
    type: String,
    description: '1–50 distinct comma-separated label UUIDs; match any.',
  })
  labelIds?: string[];

  @DateFieldOptional({ description: 'Inclusive RFC3339 instant with offset.' })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  @ValidateBy({
    name: 'taskDueFrom',
    validator: { validate: isCardDateInstant },
  })
  dueFrom?: string;

  @DateFieldOptional({
    description:
      'Exclusive RFC3339 instant with offset; must be after dueFrom.',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  @ValidateBy({ name: 'taskDueTo', validator: { validate: isCardDateInstant } })
  dueTo?: string;

  @EnumFieldOptional({
    dueDate: 'dueDate',
    updatedAt: 'updatedAt',
    board: 'board',
  })
  @ApiPropertyOptional({
    enum: ['dueDate', 'updatedAt', 'board'],
    default: 'dueDate',
  })
  sort: TaskSort = 'dueDate';
}
