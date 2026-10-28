import { WorkspaceRole } from '@kanban/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { IsIn, Matches } from 'class-validator';
import {
  EmailField,
  StringField,
  StringFieldOptional,
} from '../../../decorators/field.decorators';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import { WorkspacePageQueryDto } from './workspace-page-query.dto';
import {
  INVITATION_SEND_STATES,
  type InvitationSendState,
} from '../workspace-invitation-mailer';
import type { WorkspaceInvitation } from '../entities/workspace-invitation.entity';

export const INVITATION_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'EXPIRED',
  'REVOKED',
] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export class CreateWorkspaceInvitationDto {
  @EmailField({ trim: true, maxLength: 320 }) email!: string;
  @StringFieldOptional()
  @IsIn([WorkspaceRole.MEMBER])
  @ApiPropertyOptional({
    enum: [WorkspaceRole.MEMBER],
    default: WorkspaceRole.MEMBER,
  })
  role: WorkspaceRole = WorkspaceRole.MEMBER;
}

export class AcceptWorkspaceInvitationDto {
  @StringField({ minLength: 43, maxLength: 43 })
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  proof!: string;
}

export class WorkspaceInvitationsQueryDto extends WorkspacePageQueryDto {
  @StringFieldOptional()
  @IsIn(INVITATION_STATUSES)
  @ApiPropertyOptional({ enum: INVITATION_STATUSES })
  status?: InvitationStatus;
}

export class WorkspaceInvitationResponseDto {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) workspaceId!: string;
  @Expose() @ApiProperty() email!: string;
  @Expose() @ApiProperty({ enum: WorkspaceRole }) role!: WorkspaceRole;
  @Expose()
  @ApiProperty({ enum: INVITATION_STATUSES })
  status!: InvitationStatus;
  @Expose()
  @ApiProperty({ enum: INVITATION_SEND_STATES })
  sendState!: InvitationSendState;
  @Expose() @ApiProperty({ format: 'uuid' }) invitedById!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @Expose() @ApiProperty({ nullable: true, type: String }) consumedAt!:
    string | null;
  @Expose() @ApiProperty({ nullable: true, type: String }) revokedAt!:
    string | null;
}

export function invitationStatus(
  invitation: WorkspaceInvitation,
  now: Date,
): InvitationStatus {
  if (invitation.consumedAt) return 'ACCEPTED';
  if (invitation.revokedAt) return 'REVOKED';
  return invitation.expiresAt <= now ? 'EXPIRED' : 'PENDING';
}

export function toWorkspaceInvitationDto(
  invitation: WorkspaceInvitation,
  now: Date,
) {
  return toResponseDto(WorkspaceInvitationResponseDto, {
    id: invitation.id,
    workspaceId: invitation.workspaceId,
    email: invitation.email,
    role: invitation.role,
    status: invitationStatus(invitation, now),
    sendState: invitation.sendState,
    invitedById: invitation.invitedById,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
    updatedAt: invitation.updatedAt.toISOString(),
    consumedAt: invitation.consumedAt?.toISOString() ?? null,
    revokedAt: invitation.revokedAt?.toISOString() ?? null,
  });
}
