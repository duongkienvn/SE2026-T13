import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Workspace } from './workspace.entity';
import { User } from '../../users/entities/user.entity';
import { Board } from '../../boards/entities/board.entity';

export const WORKSPACE_ACTIVITY_TYPES = [
  'WORKSPACE_CREATED',
  'WORKSPACE_UPDATED',
  'POLICY_UPDATED',
  'MEMBER_JOINED',
  'MEMBER_ROLE_CHANGED',
  'MEMBER_REMOVED',
  'MEMBER_LEFT',
  'INVITATION_REQUESTED',
  'INVITATION_REVOKED',
  'INVITATION_DECLINED',
  'BOARD_MOVED',
] as const;
export type WorkspaceActivityType = (typeof WORKSPACE_ACTIVITY_TYPES)[number];

@Entity('workspace_activities')
@Index('IDX_workspace_activities_order', ['workspaceId', 'createdAt', 'id'])
@Index('IDX_workspace_activities_board', ['boardId'], {
  where: 'board_id IS NOT NULL',
})
@Check(
  'CK_workspace_activities_type',
  `event_type IN ('WORKSPACE_CREATED','WORKSPACE_UPDATED','POLICY_UPDATED','MEMBER_JOINED','MEMBER_ROLE_CHANGED','MEMBER_REMOVED','MEMBER_LEFT','INVITATION_REQUESTED','INVITATION_REVOKED','INVITATION_DECLINED','BOARD_MOVED')`,
)
@Check(
  'CK_workspace_activities_board',
  `(event_type = 'BOARD_MOVED' AND board_id IS NOT NULL AND board_move_version IS NOT NULL) OR (event_type <> 'BOARD_MOVED' AND board_id IS NULL AND board_move_version IS NULL)`,
)
export class WorkspaceActivity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'board_move_version', type: 'integer', nullable: true })
  boardMoveVersion!: number | null;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'FK_workspace_activities_workspace',
  })
  workspace!: Workspace;
  @Column({ name: 'actor_id', type: 'uuid', nullable: true }) actorId!:
    string | null;
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'actor_id',
    foreignKeyConstraintName: 'FK_workspace_activities_actor',
  })
  actor!: User | null;
  @Column({ name: 'event_type', type: 'varchar', length: 40 })
  eventType!: WorkspaceActivityType;
  @Column({ name: 'board_id', type: 'uuid', nullable: true }) boardId!:
    string | null;
  @ManyToOne(() => Board, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({
    name: 'board_id',
    foreignKeyConstraintName: 'FK_workspace_activities_board',
  })
  board!: Board | null;
  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'clock_timestamp()',
  })
  createdAt!: Date;
}
