import { AttachmentKind } from '@kanban/shared';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Matches, ValidateBy, ValidateIf } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
import {
  EnumField,
  NumberField,
  NumberFieldOptional,
  StringField,
  StringFieldOptional,
} from '../../../decorators/field.decorators';
import { isAttachmentUrl } from '../attachments/attachment-url';

const HttpsAttachment = () =>
  ValidateBy({
    name: 'httpsAttachment',
    validator: {
      validate: isAttachmentUrl,
      defaultMessage: () =>
        'url must be a valid HTTPS URL without credentials or control characters',
    },
  });

export class CreateAttachmentDto {
  @EnumField(AttachmentKind) kind!: AttachmentKind;
  @ValidateIf(
    (input: CreateAttachmentDto) =>
      input.kind === 'URL' || input.url !== undefined,
  )
  @StringField({ maxLength: 2048 })
  @HttpsAttachment()
  @ApiPropertyOptional({
    format: 'uri',
    example: 'https://example.com/document',
    description:
      'Required for URL. HTTPS syntax only; server never fetches the target.',
  })
  url?: string;
  @StringFieldOptional({ minLength: 1, maxLength: 120 })
  @Matches(/^[^\p{Cc}]*$/u)
  displayName?: string;
}
export class UpdateAttachmentDto {
  @NumberField({ integer: true, min: 1 }) expectedRevision!: number;
  @StringFieldOptional({ maxLength: 2048 }) @HttpsAttachment() url?: string;
  @StringFieldOptional({ minLength: 1, maxLength: 120 })
  @Matches(/^[^\p{Cc}]*$/u)
  displayName?: string;
}
export class AttachmentListQueryDto extends PageQueryDto {}
export class DeleteAttachmentQueryDto {
  @NumberFieldOptional({ integer: true, min: 1 }) expectedRevision?: number;
}
export class AttachmentReadQueryDto {}
