import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { BoardMemberRole } from '../../../common/enums/database-enums';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import { StringFieldOptional } from '../../../decorators/field.decorators';
import type { User } from '../../users/entities/user.entity';
import { WorkspacePageQueryDto } from './workspace-page-query.dto';

export class WorkspaceGuestsQueryDto extends WorkspacePageQueryDto {
  @StringFieldOptional({ trim: true, minLength: 0, maxLength: 120 })
  search?: string;
}

/** Deliberately narrower than UserResponseDto: no email or account metadata. */
export class WorkspaceGuestUserDto {
  @Expose() @ApiProperty({ format: 'uuid' }) id!: string;
  @Expose() @ApiProperty() displayName!: string;
  @Expose() @ApiProperty({ nullable: true, type: String }) avatarUrl!:
    string | null;
}

export class WorkspaceGuestBoardDto {
  @Expose() @ApiProperty({ format: 'uuid' }) boardId!: string;
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiProperty({ enum: BoardMemberRole }) role!: BoardMemberRole;
  @Expose() @ApiProperty() isArchived!: boolean;
}

export class WorkspaceGuestResponseDto {
  @Expose()
  @Type(() => WorkspaceGuestUserDto)
  @ApiProperty({ type: WorkspaceGuestUserDto })
  user!: WorkspaceGuestUserDto;

  @Expose()
  @Type(() => WorkspaceGuestBoardDto)
  @ApiProperty({ type: [WorkspaceGuestBoardDto] })
  boards!: WorkspaceGuestBoardDto[];

  @Expose()
  @ApiProperty({
    minimum: 1,
    description:
      'Number of associations whose member roster the actor may read',
  })
  visibleBoardCount!: number;
}

export function toWorkspaceGuestDto(
  user: Pick<User, 'id' | 'displayName' | 'avatarUrl' | 'avatarObjectKey'>,
  boards: WorkspaceGuestBoardDto[],
): WorkspaceGuestResponseDto {
  const objectId = user.avatarObjectKey
    ?.split('/')
    .at(-1)
    ?.replace(/\.webp$/, '');
  return toResponseDto(WorkspaceGuestResponseDto, {
    user: {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: objectId
        ? `/users/${user.id}/avatar/${objectId}`
        : user.avatarUrl,
    },
    boards,
    visibleBoardCount: boards.length,
  });
}
