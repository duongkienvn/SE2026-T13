import { WorkspaceRole } from '@kanban/shared';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Workspace } from './workspace.entity';

/** Persistence only. P2-03 owns verified-email binding and atomic consumption. */
@Entity('workspace_invitations')
@Unique('UQ_workspace_invitations_hash', ['tokenHash'])
@Check(
  'CK_workspace_invitations_email',
  `"email" = lower(btrim("email")) AND "email" ~ '^[^[:space:]@]+@[^[:space:]@]+$'`,
)
@Check('CK_workspace_invitations_role', `"role" IN ('ADMIN', 'MEMBER')`)
@Check('CK_workspace_invitations_hash', `"token_hash" ~ '^[0-9a-f]{64}$'`)
@Check('CK_workspace_invitations_expiry', `"expires_at" > "created_at"`)
@Check(
  'CK_workspace_invitations_terminal',
  `("consumed_at" IS NULL OR ("consumed_at" >= "created_at" AND "consumed_at" < "expires_at")) AND ("revoked_at" IS NULL OR "revoked_at" >= "created_at") AND NOT ("consumed_at" IS NOT NULL AND "revoked_at" IS NOT NULL)`,
)
@Index('IDX_workspace_invitations_workspace_email', ['workspaceId', 'email'])
@Index('IDX_workspace_invitations_expires_at', ['expiresAt'])
@Index('IDX_workspace_invitations_invited_by_id', ['invitedById'])
export class WorkspaceInvitation {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @ManyToOne(() => Workspace, { onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'FK_workspace_invitations_workspace',
  })
  workspace!: Workspace;
  @Column({ type: 'varchar', length: 320 }) email!: string;
  @Column({ type: 'varchar' }) role!: WorkspaceRole;
  @Column({ name: 'token_hash', type: 'char', length: 64, select: false })
  tokenHash!: string;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
  @Column({ name: 'invited_by_id', type: 'uuid' }) invitedById!: string;
  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'invited_by_id',
    foreignKeyConstraintName: 'FK_workspace_invitations_inviter',
  })
  invitedBy!: User;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
