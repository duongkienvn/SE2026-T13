import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import { Comment } from '../entities/comment.entity';

export class CommentResponseDto {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) cardId!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) authorId!: string;
  @Expose() @ApiProperty({ minLength: 1, maxLength: 2000 }) content!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export function toCommentResponseDto(comment: Comment): CommentResponseDto {
  return toResponseDto(CommentResponseDto, {
    id: comment.id,
    cardId: comment.cardId,
    authorId: comment.authorId,
    content: comment.content,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  });
}
