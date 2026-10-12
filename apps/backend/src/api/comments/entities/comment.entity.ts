import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Card } from '../../cards/entities/card.entity';
import { User } from '../../users/entities/user.entity';

@Entity('comments')
@Index('IDX_comments_card_id', ['cardId'])
export class Comment {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'card_id', type: 'uuid' }) cardId!: string;
  @ManyToOne(() => Card, (card) => card.comments, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'card_id',
    foreignKeyConstraintName: 'FK_comments_card_id',
  })
  card!: Card;
  @Column({ name: 'author_id', type: 'uuid' }) authorId!: string;
  @ManyToOne(() => User, (user) => user.comments, { onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'author_id',
    foreignKeyConstraintName: 'FK_comments_author_id',
  })
  author!: User;
  @Column({ type: 'text' }) content!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
