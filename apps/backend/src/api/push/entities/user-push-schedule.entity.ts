import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('user_push_schedules')
@Check(
  'CHK_push_schedule_start',
  `start_local ~ '^([01][0-9]|2[0-3]):(00|15|30|45)$'`,
)
@Check(
  'CHK_push_schedule_end',
  `end_local ~ '^([01][0-9]|2[0-3]):(00|15|30|45)$'`,
)
@Check('CHK_push_schedule_range', 'NOT enabled OR start_local <> end_local')
export class UserPushSchedule {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) userId!: string;
  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
  @Column({ type: 'boolean', default: false }) enabled!: boolean;
  @Column({ name: 'start_local', type: 'varchar', length: 5, default: '22:00' })
  startLocal!: string;
  @Column({ name: 'end_local', type: 'varchar', length: 5, default: '07:00' })
  endLocal!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
