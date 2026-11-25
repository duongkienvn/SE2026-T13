import { GlobalSearchType } from '@kanban/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsString,
  isUUID,
  ValidateBy,
  type ValidationArguments,
} from 'class-validator';
import { EnumFieldOptional } from '../../../decorators/field.decorators';

function integer(value: unknown): unknown {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value)
    ? Number(value)
    : value;
}

export class SearchQueryDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @ValidateBy({
    name: 'searchText',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' &&
        !value.includes('\0') &&
        !/[\uD800-\uDFFF]/u.test(value) &&
        [...value].length <= 120,
      defaultMessage: () =>
        'q must contain 0–120 Unicode characters without null bytes or malformed Unicode',
    },
  })
  @ApiPropertyOptional({
    type: String,
    maxLength: 120,
    default: '',
    description:
      'Trimmed literal case-insensitive substring. Empty returns empty groups without searching.',
  })
  q = '';

  @EnumFieldOptional(GlobalSearchType)
  @ApiPropertyOptional({ enum: GlobalSearchType, default: 'all' })
  type: GlobalSearchType = 'all';

  @Transform(({ value }: { value: unknown }) => integer(value))
  @ValidateBy({
    name: 'searchPage',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) => {
        const input = args!.object as SearchQueryDto;
        if (value === undefined) return true;
        return (
          input.type !== 'all' &&
          Number.isSafeInteger(value) &&
          Number(value) >= 1 &&
          Number.isSafeInteger((Number(value) - 1) * (input.limit ?? 20))
        );
      },
      defaultMessage: () =>
        'page is forbidden for type=all; otherwise it must be a positive safe integer with a safe pagination offset',
    },
  })
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    description:
      'Forbidden for type=all. Otherwise defaults to 1; offset must be a safe integer.',
  })
  page?: number;

  @Transform(({ value }: { value: unknown }) => integer(value))
  @ValidateBy({
    name: 'searchLimit',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) =>
        value === undefined ||
        (Number.isSafeInteger(value) &&
          Number(value) >= 1 &&
          Number(value) <=
            ((args!.object as SearchQueryDto).type === 'all' ? 10 : 50)),
      defaultMessage: () =>
        'limit must be an integer in 1–10 for type=all, or 1–50 for a specific type',
    },
  })
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: 50,
    description:
      'type=all: default 5, max 10 per group. Specific type: default 20, max 50.',
  })
  limit?: number;

  @ValidateBy({
    name: 'searchBoardScope',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) =>
        value === undefined ||
        ((args!.object as SearchQueryDto).type === 'cards' &&
          typeof value === 'string' &&
          isUUID(value, '4')),
      defaultMessage: () =>
        'boardId is an optional UUIDv4, allowed only for type=cards',
    },
  })
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description:
      'Optional Board filter for type=cards only. Omit to preserve legacy results.',
  })
  boardId?: string;
}

export function searchWindow(input: SearchQueryDto) {
  const limit = input.limit ?? (input.type === 'all' ? 5 : 20);
  return { limit, offset: ((input.page ?? 1) - 1) * limit };
}
