import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Card } from './card.entity';
import { BoardLabel } from '../../labels/entities/board-label.entity';

@Entity('card_labels')
@Index('IDX_card_labels_label_board', ['labelId', 'boardId'])
export class CardLabel {
  @PrimaryColumn({
    name: 'card_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_card_labels',
  })
  cardId!: string;
  @PrimaryColumn({
    name: 'label_id',
    type: 'uuid',
    primaryKeyConstraintName: 'PK_card_labels',
  })
  labelId!: string;
  @Column({ name: 'board_id', type: 'uuid' }) boardId!: string;
  @ManyToOne(() => Card, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      name: 'card_id',
      referencedColumnName: 'id',
      foreignKeyConstraintName: 'FK_card_labels_card_board',
    },
    {
      name: 'board_id',
      referencedColumnName: 'boardId',
      foreignKeyConstraintName: 'FK_card_labels_card_board',
    },
  ])
  card!: Card;
  @ManyToOne(() => BoardLabel, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      name: 'label_id',
      referencedColumnName: 'id',
      foreignKeyConstraintName: 'FK_card_labels_label_board',
    },
    {
      name: 'board_id',
      referencedColumnName: 'boardId',
      foreignKeyConstraintName: 'FK_card_labels_label_board',
    },
  ])
  label!: BoardLabel;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
