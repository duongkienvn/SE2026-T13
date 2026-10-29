import { WorkspaceType, type WorkspaceIdentity } from '@kanban/shared';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import type { WorkspaceIcon } from '../dto/workspace-input.dto';

@Entity('workspaces')
@Check('CK_workspaces_type', `"type" IN ('PERSONAL', 'TEAM')`)
@Check('CK_workspaces_name', `length(btrim("name")) > 0`)
@Check(
  'CK_workspaces_icon',
  `icon IN ('briefcase','users','code','palette','layers')`,
)
@Index('UQ_workspaces_personal_creator', ['createdById'], {
  unique: true,
  where: `"type" = 'PERSONAL'`,
})
@Index('IDX_workspaces_created_by_id', ['createdById'])
export class Workspace implements WorkspaceIdentity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) type!: WorkspaceType;
  @Column({ type: 'varchar', length: 120 }) name!: string;
  @Column({ type: 'text', nullable: true }) description!: string | null;
  @Column({ type: 'varchar', length: 16, nullable: true })
  icon!: WorkspaceIcon | null;
  @Column({
    name: 'board_creation_admin_only',
    type: 'boolean',
    default: false,
  })
  boardCreationAdminOnly!: boolean;
  @Column({ name: 'board_invites_enabled', type: 'boolean', default: true })
  boardInvitesEnabled!: boolean;
  @Column({
    name: 'board_membership_changes_enabled',
    type: 'boolean',
    default: true,
  })
  boardMembershipChangesEnabled!: boolean;
  @Column({
    name: 'board_visibility_changes_enabled',
    type: 'boolean',
    default: true,
  })
  boardVisibilityChangesEnabled!: boolean;
  @Column({ name: 'created_by_id', type: 'uuid' }) createdById!: string;
  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'FK_workspaces_creator',
  })
  createdBy!: User;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
