import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

export type AvatarUploadState =
  'pending' | 'processing' | 'completed' | 'rejected';

@Entity('avatar_uploads')
@Index('IDX_avatar_uploads_user_expiry', ['userId', 'expiresAt'])
@Index('IDX_avatar_uploads_cleanup', ['nextCleanupAt'])
@Unique('UQ_avatar_uploads_pending', ['pendingKey'])
@Unique('UQ_avatar_uploads_active', ['activeKey'])
@Check(
  'CK_avatar_upload_mime',
  `"content_type" IN ('image/jpeg','image/png','image/webp')`,
)
@Check('CK_avatar_upload_size', '"file_size" BETWEEN 1 AND 5242880')
@Check('CK_avatar_upload_revision', '"base_revision" >= 0')
@Check(
  'CK_avatar_upload_state',
  `"state" IN ('pending','processing','completed','rejected')`,
)
@Check('CK_avatar_upload_expiry', '"expires_at" > "created_at"')
export class AvatarUpload {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'PK_avatar_uploads',
  })
  id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_avatar_uploads_user',
  })
  user!: User;
  @Column({ name: 'pending_key', type: 'varchar' })
  pendingKey!: string;
  @Column({ name: 'active_key', type: 'varchar' })
  activeKey!: string;
  @Column({ name: 'content_type', type: 'varchar' }) contentType!: string;
  @Column({ name: 'file_size', type: 'integer' }) fileSize!: number;
  @Column({ name: 'base_revision', type: 'integer' }) baseRevision!: number;
  @Column({ type: 'varchar', default: 'pending' }) state!: AvatarUploadState;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'next_cleanup_at', type: 'timestamptz' })
  nextCleanupAt!: Date;
}
