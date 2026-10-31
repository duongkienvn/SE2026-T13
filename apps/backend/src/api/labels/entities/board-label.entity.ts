import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Board } from '../../boards/entities/board.entity';

@Entity('board_labels')
@Unique('UQ_board_labels_id_board_id', ['id', 'boardId'])
// Expression index is owned by the explicit migration.
@Index('UQ_board_labels_board_name', { synchronize: false })
@Check('CHK_board_labels_name', "name = btrim(name) AND name ~ '[^[:space:]]'")
@Check('CHK_board_labels_color', "color ~ '^#[0-9A-F]{6}$'")
export class BoardLabel {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_board_labels',
  })
  id!: string;
  @Column({ name: 'board_id', type: 'uuid' }) boardId!: string;
  @ManyToOne(() => Board, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'board_id',
    foreignKeyConstraintName: 'FK_board_labels_board_id',
  })
  board!: Board;
  @Column({ type: 'varchar', length: 120 }) name!: string;
  @Column({ type: 'varchar', length: 7 }) color!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
