import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import { Board } from '../../boards/entities/board.entity';
import { BoardColumn } from '../../columns/entities/board-column.entity';
import { CardAssignee } from './card-assignee.entity';
import { Comment } from '../../comments/entities/comment.entity';
import { User } from '../../users/entities/user.entity';

@Entity('cards')
@Unique('UQ_cards_id_board_id', ['id', 'boardId'])
@Index('IDX_cards_board_id_column_id', ['boardId', 'columnId'])
@Index('IDX_cards_column_id', ['columnId'])
export class Card {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'board_id', type: 'uuid' }) boardId!: string;
  @ManyToOne(() => Board, (board) => board.cards, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'board_id',
    foreignKeyConstraintName: 'FK_cards_board_id',
  })
  board!: Board;
  @Column({ name: 'column_id', type: 'uuid' }) columnId!: string;
  @ManyToOne(() => BoardColumn, (column) => column.cards, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'column_id',
    foreignKeyConstraintName: 'FK_cards_column_id',
  })
  column!: BoardColumn;
  @Column({ name: 'created_by_id', type: 'uuid' }) createdById!: string;
  @ManyToOne(() => User, (user) => user.cardsCreated, { onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'FK_cards_created_by_id',
  })
  createdBy!: User;
  @Column({ type: 'varchar' }) title!: string;
  @Column({ type: 'text', nullable: true }) description!: string | null;
  @Column({ type: 'numeric', precision: 20, scale: 10 }) position!: string;
  @Column({ name: 'due_date', type: 'timestamptz', nullable: true })
  dueDate!: Date | null;
  @Column({ name: 'is_archived', type: 'boolean', default: false })
  isArchived!: boolean;
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => CardAssignee, (assignee) => assignee.card)
  assignees!: CardAssignee[];
  @OneToMany(() => Comment, (comment) => comment.card) comments!: Comment[];
}
