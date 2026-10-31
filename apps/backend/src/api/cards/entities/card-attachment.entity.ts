import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { AttachmentKind, AttachmentState } from '@kanban/shared';
import { Card } from './card.entity';
import { User } from '../../users/entities/user.entity';

@Entity('card_attachments')
@Check(
  'CHK_card_attachments_identity',
  "kind IN ('URL','FILE') AND state IN ('PENDING','ACTIVE','FAILED','EXPIRED','REMOVED') AND revision > 0",
)
@Check(
  'CHK_card_attachments_name',
  "display_name = btrim(display_name) AND display_name <> '' AND display_name !~ '[[:cntrl:]]'",
)
@Check(
  'CHK_card_attachments_url_shape',
  "kind <> 'URL' OR (state IN ('ACTIVE','REMOVED') AND url IS NOT NULL AND url ~ '^https://[^/@[:space:]?#]+([/?#]|$)' AND url !~ '[[:cntrl:][:space:]]' AND position(chr(92) in url) = 0 AND length(url) <= 2048 AND original_filename IS NULL AND pending_key IS NULL AND storage_key IS NULL AND requested_mime_type IS NULL AND reserved_bytes IS NULL AND mime_type IS NULL AND byte_size IS NULL AND expires_at IS NULL AND verified_at IS NULL)",
)
@Check(
  'CHK_card_attachments_file_shape',
  "kind <> 'FILE' OR (url IS NULL AND original_filename IS NOT NULL AND original_filename <> '' AND original_filename !~ '[[:cntrl:]/]' AND position(chr(92) in original_filename) = 0 AND pending_key IS NOT NULL AND pending_key = 'attachments/v1/pending/' || id::text AND storage_key IS NOT NULL AND storage_key = 'attachments/v1/active/' || id::text AND requested_mime_type IS NOT NULL AND requested_mime_type <> '' AND reserved_bytes IS NOT NULL AND reserved_bytes BETWEEN 1 AND 9007199254740991 AND expires_at IS NOT NULL AND isfinite(expires_at) AND expires_at > created_at)",
)
@Check(
  'CHK_card_attachments_verified',
  "(verified_at IS NULL AND mime_type IS NULL AND byte_size IS NULL) OR (kind = 'FILE' AND verified_at IS NOT NULL AND isfinite(verified_at) AND mime_type IS NOT NULL AND mime_type = requested_mime_type AND byte_size IS NOT NULL AND byte_size = reserved_bytes)",
)
@Check(
  'CHK_card_attachments_file_state',
  "kind <> 'FILE' OR (state = 'ACTIVE' AND verified_at IS NOT NULL) OR state = 'REMOVED' OR (state IN ('PENDING','FAILED','EXPIRED') AND verified_at IS NULL)",
)
@Check(
  'CHK_card_attachments_idempotency',
  "(idempotency_key IS NULL AND request_hash IS NULL) OR (idempotency_key IS NOT NULL AND request_hash IS NOT NULL AND request_hash ~ '^[0-9a-f]{64}$')",
)
@Index('IDX_card_attachments_active_page', ['cardId', 'createdAt', 'id'], {
  where: "state = 'ACTIVE'",
})
@Index('IDX_card_attachments_board_state', ['boardId', 'state'])
@Index('IDX_card_attachments_uploader', ['uploaderId'])
@Index(
  'UQ_card_attachments_idempotency',
  ['cardId', 'uploaderId', 'idempotencyKey'],
  { unique: true, where: 'idempotency_key IS NOT NULL' },
)
@Index('UQ_card_attachments_pending_key', ['pendingKey'], { unique: true })
@Index('UQ_card_attachments_storage_key', ['storageKey'], { unique: true })
export class CardAttachment {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_card_attachments',
  })
  id!: string;
  @Column({ name: 'card_id', type: 'uuid' }) cardId!: string;
  @Column({ name: 'board_id', type: 'uuid' }) boardId!: string;
  @ManyToOne(() => Card, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      name: 'card_id',
      referencedColumnName: 'id',
      foreignKeyConstraintName: 'FK_card_attachments_card_board',
    },
    {
      name: 'board_id',
      referencedColumnName: 'boardId',
      foreignKeyConstraintName: 'FK_card_attachments_card_board',
    },
  ])
  card!: Card;
  @Column({ name: 'uploader_id', type: 'uuid' }) uploaderId!: string;
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'uploader_id',
    foreignKeyConstraintName: 'FK_card_attachments_uploader',
  })
  uploader!: User;
  @Column({ type: 'varchar', length: 4 }) kind!: AttachmentKind;
  @Column({ type: 'varchar', length: 7 }) state!: AttachmentState;
  @Column({ name: 'display_name', type: 'varchar', length: 120 })
  displayName!: string;
  @Column({ type: 'varchar', length: 2048, nullable: true }) url!:
    string | null;
  @Column({
    name: 'original_filename',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  originalFilename!: string | null;
  @Column({
    name: 'pending_key',
    type: 'varchar',
    length: 128,
    nullable: true,
    select: false,
  })
  pendingKey!: string | null;
  @Column({
    name: 'storage_key',
    type: 'varchar',
    length: 128,
    nullable: true,
    select: false,
  })
  storageKey!: string | null;
  @Column({
    name: 'requested_mime_type',
    type: 'varchar',
    length: 120,
    nullable: true,
    select: false,
  })
  requestedMimeType!: string | null;
  @Column({
    name: 'reserved_bytes',
    type: 'bigint',
    nullable: true,
    select: false,
  })
  reservedBytes!: string | null;
  @Column({ name: 'mime_type', type: 'varchar', length: 120, nullable: true })
  mimeType!: string | null;
  @Column({ name: 'byte_size', type: 'bigint', nullable: true }) byteSize!:
    string | null;
  @Column({
    name: 'idempotency_key',
    type: 'uuid',
    nullable: true,
    select: false,
  })
  idempotencyKey!: string | null;
  @Column({
    name: 'request_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
    select: false,
  })
  requestHash!: string | null;
  @Column({
    name: 'expires_at',
    type: 'timestamptz',
    nullable: true,
    select: false,
  })
  expiresAt!: Date | null;
  @Column({
    name: 'verified_at',
    type: 'timestamptz',
    nullable: true,
    select: false,
  })
  verifiedAt!: Date | null;
  @Column({ type: 'integer', default: 1 }) revision!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
