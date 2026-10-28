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

@Entity('workspaces')
@Check('CK_workspaces_type', `"type" IN ('PERSONAL', 'TEAM')`)
@Check('CK_workspaces_name', `length(btrim("name")) > 0`)
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
  // Representation/validation of the optional icon is deferred to P2-02.
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
