import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Activity } from '../../activities/entities/activity.entity';
import { BoardMember } from '../../board-members/entities/board-member.entity';
import { Card } from '../../cards/entities/card.entity';
import { BoardColumn } from '../../columns/entities/board-column.entity';
import { User } from '../../users/entities/user.entity';

@Entity('boards')
export class Board {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'text', nullable: true }) description!: string | null;
  @Column({ name: 'created_by_id', type: 'uuid' }) createdById!: string;
  @ManyToOne(() => User, (user) => user.boardsCreated, {
    onDelete: 'NO ACTION',
  })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'FK_boards_created_by_id',
  })
  createdBy!: User;
  @Column({ name: 'is_archived', type: 'boolean', default: false })
  isArchived!: boolean;
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => BoardMember, (member) => member.board)
  members!: BoardMember[];
  @OneToMany(() => BoardColumn, (column) => column.board)
  columns!: BoardColumn[];
  @OneToMany(() => Card, (card) => card.board) cards!: Card[];
  @OneToMany(() => Activity, (activity) => activity.board)
  activities!: Activity[];
}
