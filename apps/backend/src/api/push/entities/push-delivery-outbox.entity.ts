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
import { UserNotification } from '../../notifications/entities/user-notification.entity';
import { PushDevice } from './push-device.entity';
export type PushStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'TICKET'
  | 'RECEIPT_PROCESSING'
  | 'ACCEPTED'
  | 'FAILED'
  | 'CANCELLED'
  | 'UNKNOWN';
@Entity('push_delivery_outbox')
export class PushDeliveryOutbox {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'notification_id', type: 'uuid' }) notificationId!: string;
  @ManyToOne(() => UserNotification, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'notification_id' })
  notification!: UserNotification;
  @Column({ name: 'device_id', type: 'uuid' }) deviceId!: string;
  @ManyToOne(() => PushDevice, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device!: PushDevice;
  @Column({ name: 'recipient_user_id', type: 'uuid' }) recipientUserId!: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipient_user_id' })
  recipient!: User;
  @Column({ name: 'enrollment_revision', type: 'uuid' })
  enrollmentRevision!: string;
  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: PushStatus;
  @Column({ type: 'integer', default: 0 }) attempts!: number;
  @Column({ name: 'receipt_attempts', type: 'integer', default: 0 })
  receiptAttempts!: number;
  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt!: Date;
  @Column({ name: 'lease_owner', type: 'uuid', nullable: true }) leaseOwner!:
    string | null;
  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil!: Date | null;
  @Column({ name: 'attempted_at', type: 'timestamptz', nullable: true })
  attemptedAt!: Date | null;
  @Column({ name: 'ticket_id', type: 'varchar', length: 100, nullable: true })
  ticketId!: string | null;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({
    name: 'last_error_code',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  lastErrorCode!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
