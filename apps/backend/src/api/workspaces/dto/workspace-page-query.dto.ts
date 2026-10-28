import { IsInt, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export class WorkspacePageQueryDto extends PageQueryDto {
  @IsInt()
  @Min(1)
  @Max(1000000)
  @ApiPropertyOptional({ minimum: 1, maximum: 1000000, default: 1 })
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  limit = 20;
}
