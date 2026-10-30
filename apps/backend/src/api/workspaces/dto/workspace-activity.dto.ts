import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  WORKSPACE_ACTIVITY_TYPES,
  type WorkspaceActivityType,
} from '../entities/workspace-activity.entity';

export class WorkspaceActivityActorDto {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty() displayName!: string;
  @Expose() @ApiProperty({ type: String, nullable: true }) avatarUrl!:
    string | null;
}
export class WorkspaceActivityBoardDto {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty() name!: string;
}
export class WorkspaceActivityDto {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose()
  @ApiProperty({ enum: WORKSPACE_ACTIVITY_TYPES })
  eventType!: WorkspaceActivityType;
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @Expose()
  @Type(() => WorkspaceActivityActorDto)
  @ApiProperty({ type: WorkspaceActivityActorDto, nullable: true })
  actor!: WorkspaceActivityActorDto | null;
  @Expose()
  @Type(() => WorkspaceActivityBoardDto)
  @ApiProperty({ type: WorkspaceActivityBoardDto, nullable: true })
  board!: WorkspaceActivityBoardDto | null;
}
