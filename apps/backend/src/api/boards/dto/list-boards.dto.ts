import { IsIn } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export class ListBoardsDto extends PageQueryDto {
  @IsIn(['active', 'archived'])
  status: 'active' | 'archived' = 'active';
}
