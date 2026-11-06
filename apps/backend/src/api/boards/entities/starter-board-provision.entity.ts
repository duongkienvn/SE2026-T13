import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Board } from './board.entity';

/** One enrollment per new account, retained with boardId=null after removal. */
@Entity('starter_board_provisions')
@Unique('UQ_starter_board_provisions_board', ['boardId'])
@Check('CK_starter_board_provisions_version', 'template_version > 0')
@Check('CK_starter_board_provisions_hash', "baseline_hash ~ '^[0-9a-f]{64}$'")
export class StarterBoardProvision {
  @PrimaryColumn({
    name: 'user_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_starter_board_provisions',
  })
  userId!: string;
  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_starter_board_provisions_user',
  })
  user!: User;
  @Column({ name: 'board_id', type: 'uuid', nullable: true }) boardId!:
    string | null;
  @ManyToOne(() => Board, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'board_id',
    foreignKeyConstraintName: 'FK_starter_board_provisions_board',
  })
  board!: Board | null;
  @Column({ name: 'template_version', type: 'integer' })
  templateVersion!: number;
  @Column({ name: 'baseline_hash', type: 'varchar', length: 64 })
  baselineHash!: string;
}
