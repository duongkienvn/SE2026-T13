import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { toResponseDto } from '../../../common/dto/to-response-dto';
import { BoardMemberRole } from '../../../common/enums/database-enums';
import { Board } from '../entities/board.entity';

export class BoardResponseDto {
  @Expose()
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @Expose()
  @ApiProperty({ minLength: 1, maxLength: 120 })
  name!: string;

  @Expose()
  @ApiProperty({ type: String, nullable: true, maxLength: 2000 })
  description!: string | null;

  @Expose()
  @ApiProperty({ format: 'uuid' })
  createdById!: string;

  @Expose()
  @ApiProperty()
  isArchived!: boolean;

  @Expose()
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  archivedAt!: string | null;

  @Expose()
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @Expose()
  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @Expose()
  @ApiProperty({ enum: BoardMemberRole, enumName: 'BoardMemberRole' })
  currentUserRole!: BoardMemberRole;
}

export function toBoardResponseDto(
  board: Board,
  currentUserRole: BoardMemberRole,
): BoardResponseDto {
  return toResponseDto(BoardResponseDto, {
    id: board.id,
    name: board.name,
    description: board.description,
    createdById: board.createdById,
    isArchived: board.isArchived,
    archivedAt: board.archivedAt?.toISOString() ?? null,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    currentUserRole,
  });
}
