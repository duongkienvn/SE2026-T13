import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import { User } from '../entities/user.entity';

export class UserResponseDto {
  @Expose()
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @Expose()
  @ApiProperty({ example: 'user@example.com' })
  email!: string;

  @Expose()
  @ApiProperty({ example: 'Example User' })
  displayName!: string;

  @Expose()
  @ApiProperty({ nullable: true, type: String })
  avatarUrl!: string | null;

  @Expose()
  @ApiProperty({ minimum: 0 })
  avatarRevision!: number;

  @Expose()
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @Expose()
  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export function toUserResponseDto(user: User): UserResponseDto {
  return toResponseDto(UserResponseDto, {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarObjectKey
      ? `/users/${user.id}/avatar/${user.avatarObjectKey
          .split('/')
          .at(-1)!
          .replace(/\.webp$/, '')}`
      : user.avatarUrl,
    avatarRevision: user.avatarRevision ?? 0,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  });
}
