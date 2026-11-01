import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Board } from './board.entity';
import { User } from '../../users/entities/user.entity';

@Entity('board_user_states')
@Check(
  'CHK_board_user_states_viewed',
  'last_viewed_at IS NULL OR isfinite(last_viewed_at)',
)
@Index('IDX_board_user_states_board', ['boardId'])
@Index('IDX_board_user_states_recent', { synchronize: false })
@Index('IDX_board_user_states_starred', { synchronize: false })
export class BoardUserState {
  @PrimaryColumn({
    name: 'user_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_board_user_states',
  })
  userId!: string;
  @PrimaryColumn({
    name: 'board_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_board_user_states',
  })
  boardId!: string;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_board_user_states_user',
  })
  user!: User;
  @ManyToOne(() => Board, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'board_id',
    foreignKeyConstraintName: 'FK_board_user_states_board',
  })
  board!: Board;
  @Column({ name: 'is_starred', type: 'boolean', default: false })
  isStarred!: boolean;
  @Column({ name: 'last_viewed_at', type: 'timestamptz', nullable: true })
  lastViewedAt!: Date | null;
}
