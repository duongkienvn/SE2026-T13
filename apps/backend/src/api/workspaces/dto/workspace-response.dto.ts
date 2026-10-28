import { WorkspaceRole, WorkspaceType } from '@kanban/shared';
import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import { WorkspaceMember } from '../entities/workspace-member.entity';
import { WORKSPACE_ICONS, type WorkspaceIcon } from './workspace-input.dto';

export class WorkspaceResponseDto {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty({ enum: WorkspaceType }) type!: WorkspaceType;
  @Expose() @ApiProperty({ maxLength: 120 }) name!: string;
  @Expose()
  @ApiProperty({ type: String, nullable: true, maxLength: 2000 })
  description!: string | null;
  @Expose()
  @ApiProperty({ enum: WORKSPACE_ICONS, nullable: true })
  icon!: WorkspaceIcon | null;
  @Expose() @ApiProperty({ enum: WorkspaceRole }) role!: WorkspaceRole;
  @Expose() @ApiProperty() canManage!: boolean;
  @Expose() @ApiProperty() canCreateBoards!: boolean;
  @Expose() @ApiProperty({ format: 'date-time' }) joinedAt!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export function toWorkspaceResponseDto(
  member: WorkspaceMember,
): WorkspaceResponseDto {
  const workspace = member.workspace;
  return toResponseDto(WorkspaceResponseDto, {
    id: workspace.id,
    type: workspace.type,
    name: workspace.name,
    description: workspace.description,
    icon: workspace.icon,
    role: member.role,
    canManage: member.role === WorkspaceRole.ADMIN,
    canCreateBoards: true,
    joinedAt: member.joinedAt.toISOString(),
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  });
}
