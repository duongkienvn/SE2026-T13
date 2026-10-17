import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import {
  ActivityActionType,
  ActivityEntityType,
} from '../../../common/enums/database-enums';
import { Activity } from '../entities/activity.entity';

export class ActivityResponseDto {
  @Expose()
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @Expose()
  @ApiProperty({ format: 'uuid' })
  boardId!: string;

  @Expose()
  @ApiProperty({ format: 'uuid' })
  actorId!: string;

  @Expose()
  @ApiProperty({ enum: ActivityActionType, enumName: 'ActivityActionType' })
  actionType!: ActivityActionType;

  @Expose()
  @ApiProperty({ enum: ActivityEntityType, enumName: 'ActivityEntityType' })
  entityType!: ActivityEntityType;

  @Expose()
  @ApiProperty({ nullable: true, format: 'uuid', type: String })
  entityId!: string | null;

  @Expose()
  @ApiProperty({ nullable: true, type: Object })
  metadata!: Record<string, unknown> | null;

  @Expose()
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export function toActivityResponseDto(activity: Activity): ActivityResponseDto {
  return toResponseDto(ActivityResponseDto, {
    id: activity.id,
    boardId: activity.boardId,
    actorId: activity.actorId,
    actionType: activity.actionType,
    entityType: activity.entityType,
    entityId: activity.entityId,
    metadata: activity.metadata,
    createdAt: activity.createdAt.toISOString(),
  });
}
