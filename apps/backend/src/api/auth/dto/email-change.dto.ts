import {
  Allow,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import type { PendingEmailChangeSummary } from '@kanban/shared';
import {
  EmailField,
  StringFieldOptional,
} from '../../../decorators/field.decorators';

@ValidatorConstraint({ name: 'ExactlyOneEmailChangeProof', async: false })
class ExactlyOneEmailChangeProof implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const input = args.object as RequestEmailChangeDto;
    return (
      (input.currentPassword !== undefined) !==
      (input.googleCredential !== undefined)
    );
  }
  defaultMessage(): string {
    return 'Provide exactly one of currentPassword or googleCredential';
  }
}
export class RequestEmailChangeDto {
  @EmailField({ trim: true, maxLength: 254 })
  @Validate(ExactlyOneEmailChangeProof)
  newEmail!: string;
  @StringFieldOptional({ maxLength: 128 }) currentPassword?: string;
  @StringFieldOptional({
    maxLength: 8192,
    description:
      'Fresh Google ID credential issued within five minutes, matching the linked subject',
  })
  googleCredential?: string;
}
export class ConfirmEmailChangeDto {
  @Allow()
  @ApiProperty({
    type: String,
    description: 'Opaque, single-use 43-character base64url email-change proof',
  })
  token!: unknown;
}
export class PendingEmailChangeDto implements PendingEmailChangeSummary {
  @Expose() @ApiProperty() maskedNewEmail!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) issuedAt!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}
