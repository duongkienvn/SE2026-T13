import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** The forward-only migration owns constraints and partial indexes. */
@Entity({ name: 'task_notification_email_outbox', synchronize: false })
export class TaskNotificationEmailOutbox {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'recipient_user_id', type: 'uuid' }) recipientUserId!: string;
  @Column({ type: 'varchar', length: 32 }) kind!: string;
  @Column({ name: 'occurrence_key', type: 'varchar', length: 140 })
  occurrenceKey!: string;
  @Column({ name: 'board_id', type: 'uuid', nullable: true }) boardId!:
    string | null;
  @Column({ name: 'card_id', type: 'uuid', nullable: true }) cardId!:
    string | null;
  @Column({ type: 'varchar', length: 16 }) status!: string;
  @Column({ type: 'integer' }) attempts!: number;
  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt!: Date;
  @Column({ name: 'lease_owner', type: 'uuid', nullable: true }) leaseOwner!:
    string | null;
  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil!: Date | null;
  @Column({ name: 'first_attempt_at', type: 'timestamptz', nullable: true })
  firstAttemptAt!: Date | null;
  @Column({ name: 'last_attempt_at', type: 'timestamptz', nullable: true })
  lastAttemptAt!: Date | null;
  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
