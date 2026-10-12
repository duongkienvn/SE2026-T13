import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Card } from './card.entity';
import { User } from '../../users/entities/user.entity';

@Entity('card_assignees')
@Unique('UQ_card_assignees_card_id_user_id', ['cardId', 'userId'])
export class CardAssignee {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'card_id', type: 'uuid' }) cardId!: string;
  @ManyToOne(() => Card, (card) => card.assignees, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'card_id',
    foreignKeyConstraintName: 'FK_card_assignees_card_id',
  })
  card!: Card;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @ManyToOne(() => User, (user) => user.cardAssignments, {
    onDelete: 'NO ACTION',
  })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_card_assignees_user_id',
  })
  user!: User;
  @Column({ name: 'assigned_by_id', type: 'uuid', nullable: true })
  assignedById!: string | null;
  @ManyToOne(() => User, (user) => user.assignmentsMade, {
    onDelete: 'NO ACTION',
    nullable: true,
  })
  @JoinColumn({
    name: 'assigned_by_id',
    foreignKeyConstraintName: 'FK_card_assignees_assigned_by_id',
  })
  assignedBy!: User | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
