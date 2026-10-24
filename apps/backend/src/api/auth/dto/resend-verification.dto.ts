import { EmailField } from '../../../decorators/field.decorators';

export class ResendVerificationDto {
  @EmailField({ trim: true, maxLength: 254 })
  email!: string;
}
