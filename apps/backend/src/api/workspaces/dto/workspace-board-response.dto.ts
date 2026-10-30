import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import {
  BoardResponseDto,
  toBoardResponseDto,
} from '../../boards/dto/board-response.dto';
import { Board } from '../../boards/entities/board.entity';
import { BoardMemberRole } from '../../../common/enums/database-enums';
import { toResponseDto } from '../../../common/dto/to-response-dto';

export class WorkspaceBoardResponseDto extends BoardResponseDto {
  @Expose() @ApiProperty() canEdit!: boolean;
  @Expose()
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Explicit Board members only; null withholds the roster count from Workspace-only readers.',
  })
  memberCount!: number | null;
}

export function toWorkspaceBoardResponseDto(
  board: Board,
  role: BoardMemberRole | null,
  memberCount: number | null = null,
): WorkspaceBoardResponseDto {
  return toResponseDto(WorkspaceBoardResponseDto, {
    ...toBoardResponseDto(board, role),
    workspaceId: board.workspaceId,
    visibility: board.visibility,
    canEdit: role !== null && !board.isArchived,
    memberCount: role === null ? null : memberCount,
  });
}
