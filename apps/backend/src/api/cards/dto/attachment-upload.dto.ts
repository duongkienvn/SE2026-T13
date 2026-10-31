import type {
  CardAttachmentUploadIntent,
  CreateAttachmentUpload,
} from '@kanban/shared';
import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  NumberField,
  StringField,
  StringFieldOptional,
} from '../../../decorators/field.decorators';

export class CreateAttachmentUploadDto implements CreateAttachmentUpload {
  @StringField({ maxLength: 255 }) filename!: string;
  @StringField({ maxLength: 120 }) contentType!: string;
  @NumberField({ integer: true, min: 1 }) fileSize!: number;
  @StringFieldOptional({ maxLength: 120 }) displayName?: string;
}
export class AttachmentUploadTargetDto {
  @Expose() @ApiProperty({ enum: ['memory', 's3'] }) kind!: 'memory' | 's3';
  @Expose()
  @ApiProperty({
    description:
      'Short-lived constrained POST URL; memory mode is an authenticated API-relative path',
  })
  url!: string;
  @Expose()
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Opaque POST fields; never log or cache',
  })
  fields!: Record<string, string>;
  @Expose() @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}
export class AttachmentUploadResponseDto implements CardAttachmentUploadIntent {
  @Expose() @ApiProperty({ format: 'uuid' }) uploadId!: string;
  @Expose() @ApiProperty({ enum: ['PENDING', 'ACTIVE'] }) state!:
    'PENDING' | 'ACTIVE';
  @Expose() @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @Expose()
  @Type(() => AttachmentUploadTargetDto)
  @ApiProperty({
    type: AttachmentUploadTargetDto,
    nullable: true,
    description: 'Null for an already completed idempotent intent',
  })
  upload!: AttachmentUploadTargetDto | null;
}
export class AttachmentUploadEmptyDto {}
