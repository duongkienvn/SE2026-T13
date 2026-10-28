import { BoardVisibility } from '@kanban/shared';
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
  @Expose() @ApiProperty({ format: 'uuid' }) workspaceId!: string;
  @Expose()
  @ApiProperty({ enum: BoardVisibility })
  visibility!: BoardVisibility;
  @Expose() @ApiProperty() canEdit!: boolean;
}

export function toWorkspaceBoardResponseDto(
  board: Board,
  role: BoardMemberRole,
): WorkspaceBoardResponseDto {
  return toResponseDto(WorkspaceBoardResponseDto, {
    ...toBoardResponseDto(board, role),
    workspaceId: board.workspaceId,
    visibility: board.visibility,
    canEdit: !board.isArchived,
  });
}
