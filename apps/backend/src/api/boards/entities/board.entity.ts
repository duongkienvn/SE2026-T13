import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Activity } from '../../activities/entities/activity.entity';
import { BoardMember } from '../../board-members/entities/board-member.entity';
import { Card } from '../../cards/entities/card.entity';
import { BoardColumn } from '../../columns/entities/board-column.entity';
import { User } from '../../users/entities/user.entity';
import { BoardVisibility } from '@kanban/shared';
import { Workspace } from '../../workspaces/entities/workspace.entity';

@Entity('boards')
@Check(
  'CK_boards_visibility',
  `"visibility" IN ('PRIVATE', 'WORKSPACE_VISIBLE')`,
)
@Index('IDX_boards_workspace_id', ['workspaceId'])
export class Board {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'text', nullable: true }) description!: string | null;
  @Column({ name: 'created_by_id', type: 'uuid' }) createdById!: string;
  @ManyToOne(() => User, (user) => user.boardsCreated, {
    onDelete: 'NO ACTION',
  })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'FK_boards_created_by_id',
  })
  createdBy!: User;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({
    name: 'activity_move_version',
    type: 'integer',
    default: 0,
    select: false,
    insert: false,
    update: false,
  })
  activityMoveVersion!: number;
  @ManyToOne(() => Workspace, { onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'FK_boards_workspace',
  })
  workspace!: Workspace;
  @Column({ type: 'varchar', default: BoardVisibility.PRIVATE })
  visibility!: BoardVisibility;
  @Column({ name: 'is_archived', type: 'boolean', default: false })
  isArchived!: boolean;
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => BoardMember, (member) => member.board)
  members!: BoardMember[];
  @OneToMany(() => BoardColumn, (column) => column.board)
  columns!: BoardColumn[];
  @OneToMany(() => Card, (card) => card.board) cards!: Card[];
  @OneToMany(() => Activity, (activity) => activity.board)
  activities!: Activity[];
}
