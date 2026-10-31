import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Card } from './card.entity';
import { CardChecklistItem } from './card-checklist-item.entity';

@Entity('card_checklists')
@Unique('UQ_card_checklists_parent_position', ['cardId', 'position'], {
  deferrable: 'INITIALLY DEFERRED',
})
@Check(
  'CHK_card_checklists_text',
  "title = btrim(title) AND title ~ '[^[:space:]]'",
)
@Check('CHK_card_checklists_position', 'position > 0')
export class CardChecklist {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'card_id', type: 'uuid' }) cardId!: string;
  @ManyToOne(() => Card, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'card_id',
    foreignKeyConstraintName: 'FK_card_checklists_card_id',
  })
  card!: Card;
  @Column({ type: 'varchar', length: 120 }) title!: string;
  @Column({ type: 'numeric', precision: 20, scale: 10 }) position!: string;
  @OneToMany(() => CardChecklistItem, (item) => item.checklist)
  items!: CardChecklistItem[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
