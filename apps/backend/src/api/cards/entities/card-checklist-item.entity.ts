import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { CardChecklist } from './card-checklist.entity';

@Entity('card_checklist_items')
@Unique(
  'UQ_card_checklist_items_parent_position',
  ['checklistId', 'position'],
  { deferrable: 'INITIALLY DEFERRED' },
)
@Check(
  'CHK_card_checklist_items_text',
  "text = btrim(text) AND text ~ '[^[:space:]]'",
)
@Check('CHK_card_checklist_items_position', 'position > 0')
export class CardChecklistItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'checklist_id', type: 'uuid' }) checklistId!: string;
  @ManyToOne(() => CardChecklist, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'checklist_id',
    foreignKeyConstraintName: 'FK_card_checklist_items_checklist_id',
  })
  checklist!: CardChecklist;
  @Column({ type: 'varchar', length: 255 }) text!: string;
  @Column({ type: 'numeric', precision: 20, scale: 10 }) position!: string;
  @Column({ name: 'is_checked', type: 'boolean', default: false })
  isChecked!: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
