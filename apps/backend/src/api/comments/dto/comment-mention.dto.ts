import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CommentMentionDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') userId!: string;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) start!: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) end!: number;
}

export class CommentMentionsInput {
  @ApiPropertyOptional({ type: [CommentMentionDto], maxItems: 20 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CommentMentionDto)
  mentions?: CommentMentionDto[];
}
