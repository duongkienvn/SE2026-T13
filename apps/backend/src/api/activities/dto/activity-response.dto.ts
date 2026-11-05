import { ApiProperty } from '@nestjs/swagger';
import { Expose, Transform, Type } from 'class-transformer';
import { DeletedUserAttributionDto } from '../../users/dto/deleted-user-attribution.dto';
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
  @Type(() => DeletedUserAttributionDto)
  @Transform(
    ({ value }) =>
      value?.isDeleted === true && value?.displayName === 'Deleted user'
        ? value
        : undefined,
    { toClassOnly: true },
  )
  @ApiProperty({
    type: DeletedUserAttributionDto,
    required: false,
    description:
      'Present for a deleted actor; render without a live profile link',
  })
  actor?: DeletedUserAttributionDto;

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
    ...(activity.actor?.deletedAt
      ? { actor: new DeletedUserAttributionDto() }
      : {}),
    actionType: activity.actionType,
    entityType: activity.entityType,
    entityId: activity.entityId,
    metadata: activity.metadata,
    createdAt: activity.createdAt.toISOString(),
  });
}
