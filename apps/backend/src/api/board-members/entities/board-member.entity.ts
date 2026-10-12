import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Board } from '../../boards/entities/board.entity';
import { User } from '../../users/entities/user.entity';
import { BoardMemberRole } from '../../../common/enums/database-enums';

@Entity('board_members')
@Unique('UQ_board_members_board_id_user_id', ['boardId', 'userId'])
@Index('IDX_board_members_user_id', ['userId'])
export class BoardMember {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'board_id', type: 'uuid' }) boardId!: string;
  @ManyToOne(() => Board, (board) => board.members, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'board_id',
    foreignKeyConstraintName: 'FK_board_members_board_id',
  })
  board!: Board;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => User, (user) => user.boardMemberships, {
    onDelete: 'NO ACTION',
  })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_board_members_user_id',
  })
  user!: User;
  @Column({
    type: 'enum',
    enum: BoardMemberRole,
  })
  role!: BoardMemberRole;
  @Column({ name: 'joined_at', type: 'timestamptz', default: () => 'now()' })
  joinedAt!: Date;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
