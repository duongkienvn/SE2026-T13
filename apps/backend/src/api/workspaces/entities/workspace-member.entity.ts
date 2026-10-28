import {
  WorkspaceRole,
  type WorkspaceMembershipIdentity,
} from '@kanban/shared';
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

@Entity('workspace_members')
@Unique('UQ_workspace_members_workspace_user', ['workspaceId', 'userId'])
@Check('CK_workspace_members_role', `"role" IN ('ADMIN', 'MEMBER')`)
@Index('IDX_workspace_members_user_id', ['userId'])
@Index('IDX_workspace_members_workspace_role', ['workspaceId', 'role'])
export class WorkspaceMember implements WorkspaceMembershipIdentity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @ManyToOne(() => Workspace, { onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'FK_workspace_members_workspace',
  })
  workspace!: Workspace;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_workspace_members_user',
  })
  user!: User;
  @Column({ type: 'varchar' }) role!: WorkspaceRole;
  @Column({ name: 'joined_at', type: 'timestamptz', default: () => 'now()' })
  joinedAt!: Date;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
