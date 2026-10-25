import { applyDecorators } from '@nestjs/common';
import { Matches } from 'class-validator';
import { StringField } from '../../decorators/field.decorators';

export function NewPasswordField(): PropertyDecorator {
  return applyDecorators(
    StringField({
      minLength: 8,
      maxLength: 128,
      description:
        '8–128 characters, with an uppercase ASCII letter, an ASCII digit and a punctuation/symbol character. Whitespace is allowed but does not count as a special character.',
    }),
    Matches(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[\p{P}\p{S}])/su, {
      message:
        '$property must contain an uppercase letter (A–Z), a number (0–9), and a special character (punctuation or symbol, not whitespace)',
    }),
  );
}
