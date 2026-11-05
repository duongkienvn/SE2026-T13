import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { BoardExportFormat } from '@kanban/shared';

export class BoardExportQueryDto {
  @ApiPropertyOptional({ enum: ['json', 'csv'], default: 'json' })
  @IsIn(['json', 'csv'])
  format: BoardExportFormat = 'json';
}
export class AccountExportQueryDto {
  @ApiPropertyOptional({ enum: ['json'], default: 'json' })
  @IsIn(['json'])
  format: 'json' = 'json';
}
