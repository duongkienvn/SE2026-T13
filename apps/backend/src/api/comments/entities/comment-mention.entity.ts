import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Comment } from './comment.entity';
import { User } from '../../users/entities/user.entity';

@Entity('comment_mentions')
@Check(
  'CK_comment_mentions_offsets',
  '"start_offset" >= 0 AND "end_offset" > "start_offset" AND "end_offset" <= 4000',
)
@Unique('UQ_comment_mentions_span', ['commentId', 'start', 'end'])
@Index('IDX_comment_mentions_comment_id', ['commentId'])
export class CommentMention {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_comment_mentions_id',
  })
  id!: string;
  @Column({ name: 'comment_id', type: 'uuid' }) commentId!: string;
  @ManyToOne(() => Comment, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'comment_id',
    foreignKeyConstraintName: 'FK_comment_mentions_comment',
  })
  comment!: Comment;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_comment_mentions_user',
  })
  user!: User;
  @Column({ name: 'start_offset', type: 'integer' }) start!: number;
  @Column({ name: 'end_offset', type: 'integer' }) end!: number;
}
