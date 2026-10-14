import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import { BoardMemberRole } from '../../../common/enums/database-enums';
import {
  UserResponseDto,
  toUserResponseDto,
} from '../../users/dto/user-response.dto';
import { BoardMember } from '../entities/board-member.entity';

export class BoardMemberResponseDto {
  @Expose()
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @Expose()
  @Type(() => UserResponseDto)
  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;

  @Expose()
  @ApiProperty({ enum: BoardMemberRole, enumName: 'BoardMemberRole' })
  role!: BoardMemberRole;

  @Expose()
  @ApiProperty({ format: 'date-time' })
  joinedAt!: string;
}

export function toBoardMemberResponseDto(
  member: BoardMember,
): BoardMemberResponseDto {
  return toResponseDto(BoardMemberResponseDto, {
    id: member.id,
    user: toUserResponseDto(member.user),
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
  });
}
