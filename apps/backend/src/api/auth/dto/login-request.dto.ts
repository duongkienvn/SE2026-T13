import { EmailField, StringField } from '../../../decorators/field.decorators';

export class LoginRequestDto {
  @EmailField({ trim: true, maxLength: 254 })
  email!: string;

  @StringField({ minLength: 1, maxLength: 128 })
  password!: string;
}
