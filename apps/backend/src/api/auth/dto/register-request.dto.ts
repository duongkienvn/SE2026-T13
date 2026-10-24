import { Matches } from 'class-validator';
import { EmailField, StringField } from '../../../decorators/field.decorators';

export class RegisterRequestDto {
  @EmailField({ trim: true, maxLength: 254 })
  email!: string;

  @StringField({
    minLength: 8,
    maxLength: 128,
    description:
      '8–128 characters, with an uppercase ASCII letter, an ASCII digit and a punctuation/symbol character. Whitespace is allowed but does not count as a special character.',
  })
  @Matches(/^(?=.*[A-Z])(?=.*[0-9])(?=.*[\p{P}\p{S}])/su, {
    message:
      'password must contain an uppercase letter (A–Z), a number (0–9), and a special character (punctuation or symbol, not whitespace)',
  })
  password!: string;

  @StringField({ trim: true, minLength: 2, maxLength: 80 })
  displayName!: string;
}
