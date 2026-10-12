import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

function integerFromQuery(value: unknown): unknown {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return value;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
}

export class PageQueryDto {
  @Transform(({ value }: { value: unknown }) => integerFromQuery(value))
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page = 1;

  @Transform(({ value }: { value: unknown }) => integerFromQuery(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
