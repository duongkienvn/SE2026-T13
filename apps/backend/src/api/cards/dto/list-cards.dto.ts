import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { DateFieldOptional } from '../../../decorators/field.decorators';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
import {
  EnumFieldOptional,
  UUIDFieldOptional,
} from '../../../decorators/field.decorators';

export function csvIds(value: unknown): unknown {
  return typeof value === 'string'
    ? value.split(',').map((id) => id.toLowerCase())
    : null;
}

export class ListCardsDto extends PageQueryDto {
  @EnumFieldOptional({ TITLE: 'title', DUE_DATE: 'dueDate' })
  sortBy?: 'title' | 'dueDate';

  @EnumFieldOptional({ ASC: 'asc', DESC: 'desc' })
  sortDirection?: 'asc' | 'desc';

  @EnumFieldOptional({ ACTIVE: 'active', ARCHIVED: 'archived' })
  status?: 'active' | 'archived';

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  q?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => csvIds(value))
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  labelIds?: string[];

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => csvIds(value))
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  assigneeIds?: string[];

  @EnumFieldOptional({
    OVERDUE: 'OVERDUE',
    DUE_TODAY: 'DUE_TODAY',
    UPCOMING: 'UPCOMING',
    NO_DUE_DATE: 'NO_DUE_DATE',
  })
  dueStatus?: 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING' | 'NO_DUE_DATE';

  @DateFieldOptional() dueFrom?: string;
  @DateFieldOptional() dueTo?: string;

  @UUIDFieldOptional()
  columnId?: string;
}
