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
import type { UserPreferencesResponseDto } from '../dto/user-preferences-response.dto';
import { User } from './user.entity';

@Entity('user_preferences')
@Check('CHK_user_preferences_theme', `"theme" IN ('light', 'dark', 'system')`)
@Check(
  'CHK_user_preferences_date_format',
  `"date_format" IN ('DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD')`,
)
@Check(
  'CHK_user_preferences_week_start',
  `"week_starts_on" IN ('monday', 'sunday')`,
)
export class UserPreferences {
  @PrimaryColumn({
    name: 'user_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_user_preferences',
  })
  userId!: string;
  @Column({ type: 'varchar', default: 'system' })
  theme!: UserPreferencesResponseDto['theme'];
  @Column({ name: 'time_zone', type: 'varchar', length: 100, default: 'UTC' })
  timeZone!: string;
  @Column({ name: 'date_format', type: 'varchar', default: 'YYYY-MM-DD' })
  dateFormat!: UserPreferencesResponseDto['dateFormat'];
  @Column({ name: 'week_starts_on', type: 'varchar', default: 'monday' })
  weekStartsOn!: UserPreferencesResponseDto['weekStartsOn'];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToOne(() => User, { onDelete: 'NO ACTION', nullable: false })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_user_preferences_user',
  })
  user!: User;
}
