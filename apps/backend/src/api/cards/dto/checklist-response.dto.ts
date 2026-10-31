import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import { CardChecklist } from '../entities/card-checklist.entity';

export class ChecklistResponseDto {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) cardId!: string;
  @Expose() @ApiProperty({ maxLength: 120 }) title!: string;
  @Expose()
  @ApiProperty({ type: String, example: '100.0000000000' })
  position!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export function toChecklistResponse(row: CardChecklist): ChecklistResponseDto {
  return toResponseDto(ChecklistResponseDto, {
    id: row.id,
    cardId: row.cardId,
    title: row.title,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
