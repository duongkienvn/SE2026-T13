import { EmailField, StringField } from '../../../decorators/field.decorators';

export class RegisterRequestDto {
  @EmailField({ trim: true, maxLength: 254 })
  email!: string;

  @StringField({ minLength: 8, maxLength: 128 })
  password!: string;

  @StringField({ trim: true, minLength: 2, maxLength: 80 })
  displayName!: string;
}
