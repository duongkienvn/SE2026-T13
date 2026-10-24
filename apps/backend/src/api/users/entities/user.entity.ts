import {
  Column,
  CreateDateColumn,
  Entity,
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
export class User {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) email!: string;
  @Column({ name: 'password_hash', type: 'varchar', nullable: true })
  passwordHash!: string | null;
  @Column({ name: 'display_name', type: 'varchar' }) displayName!: string;
  @Column({ name: 'avatar_url', type: 'varchar', nullable: true }) avatarUrl!:
    string | null;
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
