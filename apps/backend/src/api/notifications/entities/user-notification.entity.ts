import { NotificationKind } from '@kanban/shared';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Workspace } from '../../workspaces/entities/workspace.entity';
import { Board } from '../../boards/entities/board.entity';
import { Card } from '../../cards/entities/card.entity';

@Entity('user_notifications')
@Unique('UQ_user_notifications_recipient_dedupe', [
  'recipientUserId',
  'dedupeKey',
])
@Check(
  'CK_user_notifications_kind',
  `kind IN ('CARD_ASSIGNED','COMMENT_MENTIONED','WORKSPACE_INVITED','BOARD_INVITED','MEMBERSHIP_CHANGED','DUE_REMINDER')`,
)
@Check(
  'CK_user_notifications_dedupe',
  `dedupe_key ~ ('^' || kind || ':[A-Za-z0-9][A-Za-z0-9:._+-]{0,159}$')`,
)
@Check(
  'CK_user_notifications_dates',
  `isfinite(created_at) AND (read_at IS NULL OR (isfinite(read_at) AND read_at >= created_at))`,
)
@Index('IDX_user_notifications_inbox', { synchronize: false })
@Index('IDX_user_notifications_unread', { synchronize: false })
@Index('IDX_user_notifications_actor', ['actorUserId'])
@Index('IDX_user_notifications_workspace', ['workspaceId'])
@Index('IDX_user_notifications_board', ['boardId'])
@Index('IDX_user_notifications_card', ['cardId'])
export class UserNotification {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'recipient_user_id', type: 'uuid' }) recipientUserId!: string;
  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'recipient_user_id',
    foreignKeyConstraintName: 'FK_user_notifications_recipient',
  })
  recipient!: User;
  @Column({ type: 'varchar' }) kind!: NotificationKind;
  @Column({ name: 'dedupe_key', type: 'varchar', length: 200 })
  dedupeKey!: string;
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;
  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'actor_user_id',
    foreignKeyConstraintName: 'FK_user_notifications_actor',
  })
  actor!: User | null;
  @Column({ name: 'workspace_id', type: 'uuid', nullable: true }) workspaceId!:
    string | null;
  @ManyToOne(() => Workspace, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'workspace_id',
    foreignKeyConstraintName: 'FK_user_notifications_workspace',
  })
  workspace!: Workspace | null;
  @Column({ name: 'board_id', type: 'uuid', nullable: true }) boardId!:
    string | null;
  @ManyToOne(() => Board, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'board_id',
    foreignKeyConstraintName: 'FK_user_notifications_board',
  })
  board!: Board | null;
  @Column({ name: 'card_id', type: 'uuid', nullable: true }) cardId!:
    string | null;
  @ManyToOne(() => Card, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'card_id',
    foreignKeyConstraintName: 'FK_user_notifications_card',
  })
  card!: Card | null;
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'clock_timestamp()',
  })
  createdAt!: Date;
  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;
}
