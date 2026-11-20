import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
/** Non-secret fence for delayed enrollment requests after logout/transfer. */
@Entity('push_device_revocations')
export class PushDeviceRevocation {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
  @PrimaryColumn({ name: 'installation_id', type: 'uuid' })
  installationId!: string;
  @Column({ name: 'session_expires_through', type: 'timestamptz' })
  sessionExpiresThrough!: Date;
}
