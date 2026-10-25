import { EmailField, StringField } from '../../../decorators/field.decorators';
import { NewPasswordField } from '../password-policy';

export class RegisterRequestDto {
  @EmailField({ trim: true, maxLength: 254 })
  email!: string;

  @NewPasswordField()
  password!: string;

  @StringField({ trim: true, minLength: 2, maxLength: 80 })
  displayName!: string;
}
