import type { AttachmentKind, CardAttachmentMetadata } from '@kanban/shared';
import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import type { CardAttachment } from '../entities/card-attachment.entity';
import { ApplicationException } from '../../../exceptions/application.exception';

export class AttachmentResponseDto implements CardAttachmentMetadata {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) boardId!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) cardId!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) uploaderId!: string;
  @Expose() @ApiProperty({ enum: ['URL', 'FILE'] }) kind!: AttachmentKind;
  @Expose() @ApiProperty({ enum: ['ACTIVE'] }) state!: 'ACTIVE';
  @Expose() @ApiProperty() displayName!: string;
  @Expose() @ApiProperty({ type: String, nullable: true, format: 'uri' }) url!:
    string | null;
  @Expose() @ApiProperty({ type: String, nullable: true }) originalFilename!:
    string | null;
  @Expose() @ApiProperty({ type: String, nullable: true }) mimeType!:
    string | null;
  @Expose() @ApiProperty({ type: Number, nullable: true }) byteSize!:
    number | null;
  @Expose() @ApiProperty({ minimum: 1 }) revision!: number;
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export function toAttachmentResponse(
  row: CardAttachment,
): AttachmentResponseDto {
  if (row.state !== 'ACTIVE')
    throw new ApplicationException(
      404,
      'ATTACHMENT_NOT_FOUND',
      'Attachment not found',
    );
  return toResponseDto(AttachmentResponseDto, {
    id: row.id,
    boardId: row.boardId,
    cardId: row.cardId,
    uploaderId: row.uploaderId,
    kind: row.kind,
    state: 'ACTIVE',
    displayName: row.displayName,
    url: row.url,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    byteSize: row.byteSize === null ? null : Number(row.byteSize),
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
