import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MaxLength, ValidateIf } from 'class-validator';
import { NumberFieldOptional } from '../../decorators/field.decorators';

export class CursorQueryDto {
  @NumberFieldOptional({ integer: true, min: 1, max: 100 })
  limit = 20;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(512)
  @ApiPropertyOptional()
  cursor?: string;
}
