import { WorkspaceRole } from '@kanban/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { IsIn } from 'class-validator';
import {
  StringField,
  StringFieldOptional,
} from '../../../decorators/field.decorators';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import { WorkspacePageQueryDto } from './workspace-page-query.dto';
import type { WorkspaceMember } from '../entities/workspace-member.entity';

export class WorkspaceMembersQueryDto extends WorkspacePageQueryDto {
  @StringFieldOptional({ trim: true, minLength: 0, maxLength: 120 })
  search?: string;

  @StringFieldOptional()
  @IsIn(Object.values(WorkspaceRole))
  @ApiPropertyOptional({ enum: WorkspaceRole })
  role?: WorkspaceRole;
}

export class UpdateWorkspaceMemberDto {
  @StringField()
  @IsIn(Object.values(WorkspaceRole))
  @ApiProperty({ enum: WorkspaceRole })
  role!: WorkspaceRole;
}

export class WorkspaceMemberResponseDto {
  @Expose() @ApiProperty({ format: 'uuid' }) userId!: string;
  @Expose() @ApiProperty() displayName!: string;
  @Expose() @ApiProperty({ nullable: true, type: String }) avatarUrl!:
    string | null;
  @Expose() @ApiProperty() avatarRevision!: number;
  @Expose() @ApiProperty({ enum: WorkspaceRole }) role!: WorkspaceRole;
  @Expose() @ApiProperty({ format: 'date-time' }) joinedAt!: string;
}

export function toWorkspaceMemberDto(member: WorkspaceMember) {
  const user = member.user;
  const objectId = user.avatarObjectKey
    ?.split('/')
    .at(-1)
    ?.replace(/\.webp$/, '');
  return toResponseDto(WorkspaceMemberResponseDto, {
    userId: member.userId,
    displayName: user.displayName,
    avatarUrl: objectId
      ? `/users/${user.id}/avatar/${objectId}`
      : user.avatarUrl,
    avatarRevision: user.avatarRevision,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
  });
}
