import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { WelcomeMessage } from '../../../mail/welcome-mailer';

/** One eligibility record per newly registered account; never backfilled. */
@Entity('welcome_email_deliveries')
@Check('CK_welcome_email_ready', '("ready_at" IS NULL) = ("message" IS NULL)')
@Check('CK_welcome_email_attempts', '"attempts" >= 0')
@Index('IDX_welcome_email_pending', ['nextAttemptAt'], {
  where:
    '"ready_at" IS NOT NULL AND "sent_at" IS NULL AND "stopped_at" IS NULL',
})
export class WelcomeEmailDelivery {
  @PrimaryColumn({
    name: 'user_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_welcome_email_deliveries',
  })
  userId!: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_welcome_email_user',
  })
  user!: User;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'ready_at', type: 'timestamptz', nullable: true })
  readyAt!: Date | null;
  @Column({ type: 'jsonb', nullable: true, select: false })
  message!: WelcomeMessage | null;
  @Column({ type: 'integer', default: 0 }) attempts!: number;
  @Column({ name: 'first_attempt_at', type: 'timestamptz', nullable: true })
  firstAttemptAt!: Date | null;
  @Column({
    name: 'next_attempt_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  nextAttemptAt!: Date;
  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil!: Date | null;
  @Column({ name: 'lease_token', type: 'uuid', nullable: true }) leaseToken!:
    string | null;
  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;
  @Column({ name: 'stopped_at', type: 'timestamptz', nullable: true })
  stoppedAt!: Date | null;
}
