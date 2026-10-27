import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Activity } from '../../activities/entities/activity.entity';
import { BoardMember } from '../../board-members/entities/board-member.entity';
import { Board } from '../../boards/entities/board.entity';
import { CardAssignee } from '../../cards/entities/card-assignee.entity';
import { Card } from '../../cards/entities/card.entity';
import { Comment } from '../../comments/entities/comment.entity';

@Entity('users')
@Unique('UQ_users_email', ['email'])
@Check('CK_users_avatar_revision', '"avatar_revision" >= 0')
@Check(
  'CK_users_avatar_owner',
  `"avatar_object_key" IS NULL OR "avatar_object_key" ~ ('^[a-z0-9/-]+/active/' || "id"::text || '/[0-9a-f-]{36}[.]webp$')`,
)
@Index('UQ_users_avatar_object_key', ['avatarObjectKey'], {
  unique: true,
  where: '"avatar_object_key" IS NOT NULL',
})
export class User {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) email!: string;
  @Column({ name: 'password_hash', type: 'varchar', nullable: true })
  passwordHash!: string | null;
  @Column({ name: 'auth_version', type: 'integer', default: 0 })
  authVersion = 0;
  @Column({ name: 'display_name', type: 'varchar' }) displayName!: string;
  @Column({ name: 'avatar_url', type: 'varchar', nullable: true }) avatarUrl!:
    string | null;
  @Column({ name: 'avatar_object_key', type: 'varchar', nullable: true })
  avatarObjectKey: string | null = null;
  @Column({ name: 'avatar_revision', type: 'integer', default: 0 })
  avatarRevision = 0;
  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => Board, (board) => board.createdBy) boardsCreated!: Board[];
  @OneToMany(() => BoardMember, (member) => member.user)
  boardMemberships!: BoardMember[];
  @OneToMany(() => Card, (card) => card.createdBy) cardsCreated!: Card[];
  @OneToMany(() => CardAssignee, (assignee) => assignee.user)
  cardAssignments!: CardAssignee[];
  @OneToMany(() => CardAssignee, (assignee) => assignee.assignedBy)
  assignmentsMade!: CardAssignee[];
  @OneToMany(() => Comment, (comment) => comment.author) comments!: Comment[];
  @OneToMany(() => Activity, (activity) => activity.actor)
  activities!: Activity[];
}
