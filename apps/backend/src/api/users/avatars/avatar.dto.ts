import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import { AVATAR_MAX_BYTES, AVATAR_MIMES } from './avatar.constants';

export class AvatarRevisionDto {
  @IsInt()
  @Min(0)
  @Max(2_147_483_646)
  @ApiProperty({ minimum: 0 })
  expectedRevision!: number;
}
export class AvatarUploadRequestDto extends AvatarRevisionDto {
  @IsIn(AVATAR_MIMES) @ApiProperty({ enum: AVATAR_MIMES }) contentType!: string;
  @IsInt()
  @Min(1)
  @Max(AVATAR_MAX_BYTES)
  @ApiProperty({ minimum: 1, maximum: AVATAR_MAX_BYTES })
  fileSize!: number;
}
export class AvatarUploadTargetDto {
  @Expose() @ApiProperty({ enum: ['s3', 'memory'] }) kind!: 's3' | 'memory';
  @Expose() @ApiProperty() url!: string;
  @Expose() @ApiProperty({ type: Object }) fields!: Record<string, string>;
}
export class AvatarUploadResponseDto {
  @Expose() @ApiProperty({ format: 'uuid' }) uploadId!: string;
  @Expose() @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @Expose()
  @Type(() => AvatarUploadTargetDto)
  @ApiProperty({ type: AvatarUploadTargetDto })
  upload!: AvatarUploadTargetDto;
}
