import { applyDecorators } from '@nestjs/common';
import { ValidateBy } from 'class-validator';
import { isCardDateInstant } from '@kanban/shared';
import { DateFieldOptional } from '../../../decorators/field.decorators';

/** Card-only strictness keeps unrelated feature DateField contracts unchanged. */
export function CardDateFieldOptional(example: string): PropertyDecorator {
  return applyDecorators(
    DateFieldOptional({
      nullable: true,
      example,
      description:
        'Explicit ISO 8601 timestamp with Z or offset, stored/returned as UTC milliseconds. Bare dates and local date-times are rejected. Omission preserves; null clears. When both dates exist, startDate must be <= dueDate.',
    }),
    ValidateBy({
      name: 'isCardDateInstant',
      validator: {
        validate: isCardDateInstant,
        defaultMessage: () =>
          'Date must be a valid calendar date-time with an explicit timezone and supported UTC year',
      },
    }),
  );
}
