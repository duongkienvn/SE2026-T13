import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorResponseDto {
  @ApiProperty({ example: false, enum: [false] })
  success!: false;

  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ example: 'VALIDATION_FAILED' })
  code!: string;

  @ApiProperty({ example: 'Validation failed' })
  message!: string;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;

  @ApiProperty({ example: '/api/boards' })
  path!: string;

  @ApiPropertyOptional({ type: [String] })
  details?: string[];

  @ApiPropertyOptional()
  requestId?: string;
}

export class ApiSuccessEnvelopeDto {
  @ApiProperty({ example: true, enum: [true] })
  success!: true;

  @ApiProperty({ example: 200 })
  statusCode!: number;

  @ApiProperty({ example: 'OK' })
  message!: string;

  @ApiProperty()
  data!: unknown;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 53 })
  total!: number;

  @ApiProperty({ example: 3 })
  totalPages!: number;
}

export class CursorPaginationMetaDto {
  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
