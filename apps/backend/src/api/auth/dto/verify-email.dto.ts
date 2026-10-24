import { Matches } from 'class-validator';
import { StringField } from '../../../decorators/field.decorators';

export class VerifyEmailDto {
  @StringField({ minLength: 43, maxLength: 43 })
  @Matches(/^[A-Za-z0-9_-]{43}$/, {
    message: 'token must be a URL-safe verification token',
  })
  token!: string;
}
