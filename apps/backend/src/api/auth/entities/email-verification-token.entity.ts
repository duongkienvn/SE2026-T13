import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

// One current token per user. Rotation replaces its hash, never stores plaintext.
@Entity('email_verification_tokens')
@Index('UQ_email_verification_user', ['userId'], { unique: true })
@Index('UQ_email_verification_hash', ['tokenHash'], { unique: true })
export class EmailVerificationToken {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_email_verification_user',
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
  @Column({ name: 'attempts', type: 'integer' }) attempts!: number;
}
