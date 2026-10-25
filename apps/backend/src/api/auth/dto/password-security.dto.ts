import { Allow } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EmailField, StringField } from '../../../decorators/field.decorators';
import { NewPasswordField } from '../password-policy';

export class ForgotPasswordDto {
  @EmailField({ trim: true, maxLength: 254 }) email!: string;
}
export class ResetPasswordDto {
  // The service maps *all* malformed proofs to INVALID_PASSWORD_RESET_TOKEN.
  @Allow()
  @ApiProperty({
    type: String,
    description: 'Opaque single-use recovery token (43 base64url characters)',
  })
  token!: unknown;
  @NewPasswordField() newPassword!: string;
}
export class ChangePasswordDto {
  @StringField({ maxLength: 128 }) currentPassword!: string;
  @NewPasswordField() newPassword!: string;
}
