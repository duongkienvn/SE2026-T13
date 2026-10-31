import type { CardDateInput } from '@kanban/shared';
import { CardDateFieldOptional } from './card-date-field.decorator';
import { StringFieldOptional } from '../../../decorators/field.decorators';

export class UpdateCardDto implements CardDateInput {
  @StringFieldOptional({ trim: true, minLength: 1, maxLength: 120 })
  title?: string;

  @StringFieldOptional({ nullable: true, minLength: 0, maxLength: 2000 })
  description?: string | null;

  @CardDateFieldOptional('2026-03-08T01:30:00-05:00')
  startDate?: string | null;

  @CardDateFieldOptional('2026-03-08T03:30:00-04:00')
  dueDate?: string | null;
}
