import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/** Retain consumed/expired rows: issuance timestamps enforce a rolling quota. */
@Entity('pending_email_changes')
@Index('UQ_email_change_user', ['userId'], { unique: true })
@Index('UQ_email_change_hash', ['tokenHash'], { unique: true })
@Index('IX_email_change_expiry', ['expiresAt'])
@Check('CK_email_change_hash', "token_hash ~ '^[0-9a-f]{64}$'")
@Check(
  'CK_email_change_email',
  'new_email = lower(btrim(new_email)) AND original_email = lower(btrim(original_email)) AND length(new_email) BETWEEN 3 AND 254 AND length(original_email) BETWEEN 3 AND 254',
)
@Check('CK_email_change_version', 'original_auth_version >= 0')
@Check(
  'CK_email_change_dates',
  "isfinite(created_at) AND isfinite(expires_at) AND expires_at = created_at + interval '30 minutes' AND (consumed_at IS NULL OR (isfinite(consumed_at) AND consumed_at >= created_at)) AND (sent_at IS NULL OR (isfinite(sent_at) AND sent_at >= created_at))",
)
@Check(
  'CK_email_change_quota',
  'cardinality(issuance_attempts) BETWEEN 1 AND 5 AND array_ndims(issuance_attempts) = 1 AND array_position(issuance_attempts, NULL) IS NULL',
)
export class PendingEmailChange {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_email_change_user',
  })
  user!: User;
  @Column({ name: 'token_hash', type: 'char', length: 64 }) tokenHash!: string;
  @Column({ name: 'new_email', type: 'varchar', length: 254 })
  newEmail!: string;
  @Column({ name: 'original_email', type: 'varchar', length: 254 })
  originalEmail!: string;
  @Column({ name: 'original_auth_version', type: 'integer' })
  originalAuthVersion!: number;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;
  @Column({ name: 'issuance_attempts', type: 'timestamptz', array: true })
  issuanceAttempts!: Date[];
}
