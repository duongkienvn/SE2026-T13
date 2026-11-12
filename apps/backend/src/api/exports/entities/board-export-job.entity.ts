import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Board } from '../../boards/entities/board.entity';
import type { ExportJobRecord } from '../export-job-policy';

@Entity('board_export_jobs')
@Unique('UQ_board_export_jobs_operation', ['userId', 'idempotencyKey'])
@Check(
  'CK_board_export_jobs_state',
  `state IN ('PENDING','RUNNING','COMPLETED','FAILED') AND format IN ('json','csv') AND attempts BETWEEN 0 AND 3`,
)
@Check(
  'CK_board_export_jobs_lease',
  `(state = 'RUNNING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR (state <> 'RUNNING' AND lease_token IS NULL AND lease_expires_at IS NULL)`,
)
@Check(
  'CK_board_export_jobs_bounds',
  `isfinite(expires_at) AND expires_at > created_at AND (body IS NULL OR octet_length(body) <= 20971520)`,
)
@Index('IDX_board_export_jobs_due', ['state', 'expiresAt'])
@Index('IDX_board_export_jobs_board', ['boardId'])
export class BoardExportJob implements ExportJobRecord {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_board_export_jobs',
  })
  id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_board_export_jobs_user',
  })
  user!: User;
  @Column({ name: 'board_id', type: 'uuid' }) boardId!: string;
  @ManyToOne(() => Board, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'board_id',
    foreignKeyConstraintName: 'FK_board_export_jobs_board',
  })
  board!: Board;
  @Column({ name: 'idempotency_key', type: 'uuid', select: false })
  idempotencyKey!: string;
  @Column({ type: 'varchar', length: 4 }) format!: 'json' | 'csv';
  @Column({ type: 'varchar', length: 9, default: 'PENDING' })
  state!: ExportJobRecord['state'];
  @Column({ type: 'integer', default: 0 }) attempts!: number;
  @Column({ name: 'auth_version', type: 'integer', select: false })
  authVersion!: number;
  @Column({ name: 'session_expires_at', type: 'timestamptz', select: false })
  sessionExpiresAt!: Date;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'lease_token', type: 'uuid', nullable: true, select: false })
  leaseToken!: string | null;
  @Column({
    name: 'lease_expires_at',
    type: 'timestamptz',
    nullable: true,
    select: false,
  })
  leaseExpiresAt!: Date | null;
  @Column({ type: 'bytea', nullable: true, select: false })
  body!: Buffer | null;
}
