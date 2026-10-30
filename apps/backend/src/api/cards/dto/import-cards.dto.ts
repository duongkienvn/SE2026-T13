import { ApiProperty, OmitType } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray } from 'class-validator';
import { UUIDField } from '../../../decorators/field.decorators';
import { CardResponseDto } from './card-response.dto';
import { CreateCardDto } from './create-card.dto';

export const MAX_CARD_IMPORT_ROWS = 100;

/** One imported row keeps every CreateCardDto rule except the shared column. */
export class ImportCardRowDto extends OmitType(CreateCardDto, [
  'columnId',
] as const) {}

export class ImportCardsDto {
  @UUIDField()
  columnId!: string;

  // Rows are validated one by one in the service so a bad row cannot reject the batch.
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    minItems: 1,
    maxItems: MAX_CARD_IMPORT_ROWS,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CARD_IMPORT_ROWS)
  items!: unknown[];
}

export class ImportCardRejectionDto {
  @Expose() @ApiProperty({ minimum: 0 }) index!: number;
  @Expose() @ApiProperty({ type: [String] }) details!: string[];
}

export class ImportCardsResponseDto {
  @Expose() @ApiProperty({ minimum: 0 }) createdCount!: number;
  @Expose() @ApiProperty({ minimum: 0 }) rejectedCount!: number;
  @Expose()
  @Type(() => CardResponseDto)
  @ApiProperty({ type: () => [CardResponseDto] })
  created!: CardResponseDto[];
  @Expose()
  @Type(() => ImportCardRejectionDto)
  @ApiProperty({ type: () => [ImportCardRejectionDto] })
  rejected!: ImportCardRejectionDto[];
}
