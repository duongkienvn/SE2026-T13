import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/** Durable tombstone: deliberately no FK to a deletable Card, Board or User. */
@Entity('card_attachment_cleanup_jobs')
@Check(
  'CHK_attachment_cleanup_key',
  "object_key IN ('attachments/v1/pending/' || attachment_id::text, 'attachments/v1/active/' || attachment_id::text)",
)
@Check(
  'CHK_attachment_cleanup_retry',
  'attempts >= 0 AND next_attempt_at >= not_before',
)
@Index('IDX_attachment_cleanup_due', ['nextAttemptAt', 'objectKey'], {
  where: 'completed_at IS NULL',
})
export class AttachmentCleanupJob {
  @PrimaryColumn({
    name: 'object_key',
    type: 'varchar',
    length: 128,
    primaryKeyConstraintName: 'PK_card_attachment_cleanup_jobs',
  })
  objectKey!: string;
  @Column({ name: 'attachment_id', type: 'uuid' }) attachmentId!: string;
  @Column({ name: 'not_before', type: 'timestamptz' }) notBefore!: Date;
  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt!: Date;
  @Column({ type: 'integer', default: 0 }) attempts!: number;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
