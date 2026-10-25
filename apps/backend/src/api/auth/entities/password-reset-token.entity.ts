import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/** One current recovery proof per account, independent of email verification. */
@Entity('password_reset_tokens')
@Index('UQ_password_reset_user', ['userId'], { unique: true })
@Index('UQ_password_reset_hash', ['tokenHash'], { unique: true })
@Index('IX_password_reset_expiry', ['expiresAt'])
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_password_reset_user',
  })
  user!: User;
  @Column({ name: 'token_hash', type: 'char', length: 64 }) tokenHash!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;
  @Column({ name: 'window_started_at', type: 'timestamptz' })
  windowStartedAt!: Date;
  @Column({ type: 'integer' }) attempts!: number;
}
