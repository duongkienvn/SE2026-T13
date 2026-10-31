import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import { CardChecklist } from '../entities/card-checklist.entity';
import { CardChecklistItem } from '../entities/card-checklist-item.entity';

export class ChecklistProgressDto {
  @Expose() @ApiProperty() checkedItems!: number;
  @Expose() @ApiProperty() totalItems!: number;
  @Expose()
  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description: 'Rounded integer percent; empty is zero',
  })
  completionPercentage!: number;
}
export class ChecklistItemResponseDto {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) checklistId!: string;
  @Expose() @ApiProperty({ maxLength: 255 }) text!: string;
  @Expose() @ApiProperty() isChecked!: boolean;
  @Expose() @ApiProperty({ type: String }) position!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class ChecklistResponseDto extends ChecklistProgressDto {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) cardId!: string;
  @Expose() @ApiProperty({ maxLength: 120 }) title!: string;
  @Expose()
  @ApiProperty({ type: String, example: '100.0000000000' })
  position!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @Expose()
  @Type(() => ChecklistItemResponseDto)
  @ApiProperty({ type: () => [ChecklistItemResponseDto], maxItems: 200 })
  items!: ChecklistItemResponseDto[];
}
export class CardChecklistSummaryDto extends ChecklistProgressDto {
  @Expose() @ApiProperty({ format: 'uuid' }) cardId!: string;
}
export class CardChecklistsResponseDto extends CardChecklistSummaryDto {
  @Expose()
  @Type(() => ChecklistResponseDto)
  @ApiProperty({ type: () => [ChecklistResponseDto], maxItems: 50 })
  checklists!: ChecklistResponseDto[];
}
export function checklistProgress(
  checkedItems: number,
  totalItems: number,
): ChecklistProgressDto {
  return {
    checkedItems,
    totalItems,
    completionPercentage:
      totalItems === 0 ? 0 : Math.round((checkedItems * 100) / totalItems),
  };
}
function toItemResponse(row: CardChecklistItem): ChecklistItemResponseDto {
  return toResponseDto(ChecklistItemResponseDto, {
    id: row.id,
    checklistId: row.checklistId,
    text: row.text,
    isChecked: row.isChecked,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
export function toChecklistResponse(row: CardChecklist): ChecklistResponseDto {
  const items = row.items ?? [];
  return toResponseDto(ChecklistResponseDto, {
    id: row.id,
    cardId: row.cardId,
    title: row.title,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    items: items.map(toItemResponse),
    ...checklistProgress(
      items.filter((item) => item.isChecked).length,
      items.length,
    ),
  });
}
