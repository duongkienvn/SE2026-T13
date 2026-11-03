import { NotificationKind, type NotificationResponse } from '@kanban/shared';
import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';

export class NotificationActorDto {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty() displayName!: string;
}
export class NotificationContextDto {
  @Expose()
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  workspaceId!: string | null;
  @Expose()
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  boardId!: string | null;
  @Expose()
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  cardId!: string | null;
}
export class NotificationTargetDto {
  @Expose()
  @ApiProperty({ enum: ['workspace', 'board', 'card', 'invitation'] })
  kind!: NonNullable<NotificationResponse['target']>['kind'];
  @Expose()
  @ApiProperty({
    description:
      'Server-built relative application route. Render text; never interpret notification summaries as HTML.',
  })
  path!: string;
}
export class NotificationResponseDto implements NotificationResponse {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty({ enum: NotificationKind }) kind!: NotificationKind;
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @Expose()
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt!: string | null;
  @Expose()
  @Type(() => NotificationActorDto)
  @ApiProperty({ type: NotificationActorDto, nullable: true })
  actor!: NotificationActorDto | null;
  @Expose() @ApiProperty() summary!: string;
  @Expose()
  @Type(() => NotificationContextDto)
  @ApiProperty({ type: NotificationContextDto, nullable: true })
  context!: NotificationContextDto | null;
  @Expose()
  @Type(() => NotificationTargetDto)
  @ApiProperty({ type: NotificationTargetDto, nullable: true })
  target!: NotificationTargetDto | null;
  @Expose() @ApiProperty() isUnavailable!: boolean;
}
export class NotificationUnreadCountDto {
  @Expose() @ApiProperty({ minimum: 0 }) count!: number;
}
export class NotificationReadAllResultDto {
  @Expose() @ApiProperty({ minimum: 0 }) updatedCount!: number;
}
