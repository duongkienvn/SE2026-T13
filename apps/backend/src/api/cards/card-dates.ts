import { HttpStatus } from '@nestjs/common';
import { parseCardDateInstant, type CardDateInput } from '@kanban/shared';
import { ApplicationException } from '../../exceptions/application.exception';
import type { Card } from './entities/card.entity';

/** Call inside the Board transaction, after loading the persisted counterpart. */
export function resolveCardDates(
  input: CardDateInput,
  current?: Pick<Card, 'startDate' | 'dueDate'>,
): { startDate: Date | null; dueDate: Date | null } {
  const resolve = (field: 'startDate' | 'dueDate'): Date | null => {
    const value = input[field];
    if (value === undefined) return current?.[field] ?? null;
    if (value === null) return null;
    try {
      return parseCardDateInstant(value);
    } catch {
      throw new ApplicationException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        `${field} must be a valid date-time with an explicit timezone`,
      );
    }
  };
  const startDate = resolve('startDate'),
    dueDate = resolve('dueDate');
  if (startDate && dueDate && startDate.getTime() > dueDate.getTime())
    throw new ApplicationException(
      HttpStatus.BAD_REQUEST,
      'CARD_DATE_RANGE_INVALID',
      'startDate must be before or equal to dueDate',
    );
  return { startDate, dueDate };
}
