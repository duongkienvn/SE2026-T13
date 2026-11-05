import { Equals } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { StringFieldOptional } from '../../../decorators/field.decorators';

export class DeleteAccountDto {
  @Equals('DELETE')
  @ApiProperty({
    enum: ['DELETE'],
    description: 'Exact case-sensitive literal; no trimming',
  })
  confirmation!: 'DELETE';

  @StringFieldOptional({ maxLength: 128 })
  currentPassword?: string;

  @StringFieldOptional({
    maxLength: 8192,
    description:
      'Google ID credential issued within five minutes, matching the existing linked subject. Supply exactly one proof.',
  })
  googleCredential?: string;
}
