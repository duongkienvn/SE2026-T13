import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import { CardAssignee } from '../entities/card-assignee.entity';

export class CardAssigneeResponseDto {
  @Expose()
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @Expose()
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  assignedById!: string | null;

  @Expose()
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export function toCardAssigneeResponseDto(
  assignee: CardAssignee,
): CardAssigneeResponseDto {
  return toResponseDto(CardAssigneeResponseDto, {
    userId: assignee.userId,
    assignedById: assignee.assignedById,
    createdAt: assignee.createdAt.toISOString(),
  });
}
