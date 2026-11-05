import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import { Comment } from '../entities/comment.entity';
import { CommentMentionDto } from './comment-mention.dto';

export class CommentMentionResponseDto {
  @Expose() @ApiProperty({ format: 'uuid' }) userId!: string;
  @Expose() @ApiProperty({ minimum: 0 }) start!: number;
  @Expose() @ApiProperty({ minimum: 1 }) end!: number;
}

export class CommentResponseDto {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) cardId!: string;
  @Expose() @ApiProperty({ format: 'uuid' }) authorId!: string;
  @Expose() @ApiProperty({ minLength: 1, maxLength: 2000 }) content!: string;
  @Expose()
  @Type(() => CommentMentionResponseDto)
  @ApiProperty({ type: [CommentMentionResponseDto] })
  mentions!: CommentMentionResponseDto[];
  @Expose() @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export function toCommentResponseDto(
  comment: Comment,
  mentions: CommentMentionDto[] = [],
): CommentResponseDto {
  return toResponseDto(CommentResponseDto, {
    id: comment.id,
    cardId: comment.cardId,
    authorId: comment.authorId,
    content: comment.content,
    mentions: mentions.map(({ userId, start, end }) => ({
      userId,
      start,
      end,
    })),
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  });
}
