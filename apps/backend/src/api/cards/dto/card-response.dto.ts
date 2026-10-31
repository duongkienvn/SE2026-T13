import type { CardDateFields } from '@kanban/shared';
import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import { Card } from '../entities/card.entity';
import {
  CardAssigneeResponseDto,
  toCardAssigneeResponseDto,
} from './card-assignee-response.dto';

export class CardResponseDto implements CardDateFields {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) boardId!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) columnId!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) createdById!: string;
  @Expose() @ApiProperty({ minLength: 1, maxLength: 120 }) title!: string;
  @Expose()
  @ApiProperty({ type: String, nullable: true, maxLength: 2000 })
  description!: string | null;
  @Expose()
  @ApiProperty({ type: String, example: '100.0000000000' })
  position!: string;
  @Expose()
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-03-08T06:30:00.000Z',
    description: 'UTC start instant; null means no start date',
  })
  startDate!: string | null;
  @Expose()
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-03-08T07:30:00.000Z',
    description: 'Existing UTC deadline instant; null means no due date',
  })
  dueDate!: string | null;
  @Expose() @ApiProperty() isArchived!: boolean;
  @Expose()
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  archivedAt!: string | null;
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @Expose()
  @Type(() => CardAssigneeResponseDto)
  @ApiProperty({ type: () => [CardAssigneeResponseDto] })
  assignees!: CardAssigneeResponseDto[];
}

export function toCardResponseDto(card: Card): CardResponseDto {
  return toResponseDto(CardResponseDto, {
    id: card.id,
    boardId: card.boardId,
    columnId: card.columnId,
    createdById: card.createdById,
    title: card.title,
    description: card.description,
    position: card.position,
    startDate: card.startDate?.toISOString() ?? null,
    dueDate: card.dueDate?.toISOString() ?? null,
    isArchived: card.isArchived,
    archivedAt: card.archivedAt?.toISOString() ?? null,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
    assignees: (card.assignees ?? []).map(toCardAssigneeResponseDto),
  });
}
