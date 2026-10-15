import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUrl, ValidateIf } from 'class-validator';
import { StringFieldOptional } from '../../../decorators/field.decorators';

export class UpdateUserProfileDto {
  @StringFieldOptional({ trim: true, minLength: 2, maxLength: 80 })
  displayName?: string;

  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsString()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    format: 'uri',
    example: 'https://cdn.example.com/avatar.png',
  })
  avatarUrl?: string | null;
}
