import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { WorkspaceResponseDto } from './workspace-response.dto';
import { WorkspaceBoardResponseDto } from './workspace-board-response.dto';

export class WorkspaceOverviewDto {
  @Expose()
  @Type(() => WorkspaceResponseDto)
  @ApiProperty({ type: WorkspaceResponseDto })
  workspace!: WorkspaceResponseDto;
  @Expose() @ApiProperty() visibleBoardCount!: number;
  @Expose() @ApiProperty() activeBoardCount!: number;
  @Expose() @ApiProperty() archivedBoardCount!: number;
  @Expose()
  @ApiProperty({
    type: Number,
    description:
      'Explicit Workspace members, including the Personal owner; Board-only guests are excluded.',
  })
  memberCount!: number;
  @Expose()
  @Type(() => WorkspaceBoardResponseDto)
  @ApiProperty({ type: [WorkspaceBoardResponseDto] })
  recentBoards!: WorkspaceBoardResponseDto[];
}
