import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
@Entity('push_devices')
export class PushDevice {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
  @Column({ name: 'installation_id', type: 'uuid', unique: true })
  installationId!: string;
  @Column({
    name: 'token_fingerprint',
    type: 'varchar',
    length: 64,
    unique: true,
    select: false,
  })
  tokenFingerprint!: string;
  @Column({ name: 'encrypted_token', type: 'text', select: false })
  encryptedToken!: string;
  @Column({ type: 'varchar', length: 7 }) platform!: 'android' | 'ios';
  @Column({ name: 'app_environment', type: 'varchar', length: 11 })
  appEnvironment!: string;
  @Column({ name: 'project_id', type: 'uuid' }) projectId!: string;
  @Column({ type: 'boolean', default: true }) active!: boolean;
  @Column({ name: 'auth_version', type: 'integer' }) authVersion!: number;
  @Column({ name: 'session_expires_at', type: 'timestamptz' })
  sessionExpiresAt!: Date;
  @Column({ name: 'enrollment_revision', type: 'uuid' })
  enrollmentRevision!: string;
  @Column({
    name: 'retired_sessions',
    type: 'jsonb',
    default: {},
    select: false,
  })
  retiredSessions!: Record<string, number>;
  @Column({ name: 'lease_until', type: 'timestamptz' }) leaseUntil!: Date;
  @Column({ name: 'last_seen_at', type: 'timestamptz' }) lastSeenAt!: Date;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
