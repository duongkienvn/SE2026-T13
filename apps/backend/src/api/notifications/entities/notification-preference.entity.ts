import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('notification_preferences')
export class NotificationPreference {
  @PrimaryColumn({
    name: 'user_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_notification_preferences',
  })
  userId!: string;
  @OneToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_notification_preferences_user',
  })
  user!: User;
  @Column({ name: 'in_app_card_assigned', type: 'boolean', default: true })
  inAppCardAssigned!: boolean;
  @Column({ name: 'in_app_comment_mentioned', type: 'boolean', default: true })
  inAppCommentMentioned!: boolean;
  @Column({ name: 'in_app_workspace_invited', type: 'boolean', default: true })
  inAppWorkspaceInvited!: boolean;
  @Column({ name: 'in_app_board_invited', type: 'boolean', default: true })
  inAppBoardInvited!: boolean;
  @Column({ name: 'in_app_membership_changed', type: 'boolean', default: true })
  inAppMembershipChanged!: boolean;
  @Column({ name: 'in_app_due_reminder', type: 'boolean', default: true })
  inAppDueReminder!: boolean;
  @Column({ name: 'email_card_assigned', type: 'boolean', default: false })
  emailCardAssigned!: boolean;
  @Column({ name: 'email_comment_mentioned', type: 'boolean', default: false })
  emailCommentMentioned!: boolean;
  @Column({ name: 'email_due_reminder', type: 'boolean', default: false })
  emailDueReminder!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
