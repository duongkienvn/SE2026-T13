import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Board } from '../../boards/entities/board.entity';
import { User } from '../../users/entities/user.entity';
import {
  ActivityActionType,
  ActivityEntityType,
} from '../../../common/enums/database-enums';

@Entity('activities')
@Index('IDX_activities_board_id_created_at', ['boardId', 'createdAt'])
export class Activity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'board_id', type: 'uuid' }) boardId!: string;
  @ManyToOne(() => Board, (board) => board.activities, {
    onDelete: 'NO ACTION',
  })
  @JoinColumn({
    name: 'board_id',
    foreignKeyConstraintName: 'FK_activities_board_id',
  })
  board!: Board;
  @Column({ name: 'actor_id', type: 'uuid' }) actorId!: string;
  @ManyToOne(() => User, (user) => user.activities, { onDelete: 'NO ACTION' })
  @JoinColumn({
    name: 'actor_id',
    foreignKeyConstraintName: 'FK_activities_actor_id',
  })
  actor!: User;
  @Column({
    name: 'action_type',
    type: 'enum',
    enum: ActivityActionType,
  })
  actionType!: ActivityActionType;
  @Column({
    name: 'entity_type',
    type: 'enum',
    enum: ActivityEntityType,
  })
  entityType!: ActivityEntityType;
  @Column({ name: 'entity_id', type: 'uuid', nullable: true }) entityId!:
    string | null;
  @Column({ type: 'jsonb', nullable: true }) metadata!: Record<
    string,
    unknown
  > | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
