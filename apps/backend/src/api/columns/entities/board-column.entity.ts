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
} from 'typeorm';
import { Board } from '../../boards/entities/board.entity';
import { Card } from '../../cards/entities/card.entity';

@Entity('board_columns')
@Index('IDX_board_columns_board_id_position', ['boardId', 'position'])
export class BoardColumn {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'board_id', type: 'uuid' }) boardId!: string;
  @ManyToOne(() => Board, (board) => board.columns, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'board_id',
    foreignKeyConstraintName: 'FK_board_columns_board_id',
  })
  board!: Board;
  @Column({ type: 'varchar' }) name!: string;
  // PostgreSQL numeric values are returned as strings to preserve all ten fractional digits.
  @Column({ type: 'numeric', precision: 20, scale: 10 }) position!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => Card, (card) => card.column) cards!: Card[];
}
