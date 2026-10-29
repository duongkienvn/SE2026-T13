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
}

export function toWorkspaceBoardResponseDto(
  board: Board,
  role: BoardMemberRole | null,
): WorkspaceBoardResponseDto {
  return toResponseDto(WorkspaceBoardResponseDto, {
    ...toBoardResponseDto(board, role),
    workspaceId: board.workspaceId,
    visibility: board.visibility,
    canEdit: role !== null && !board.isArchived,
  });
}
