import { PageQueryDto } from '../../../common/dto/page-query.dto';
import { UUIDFieldOptional } from '../../../decorators/field.decorators';

export class ListCardsDto extends PageQueryDto {
  @UUIDFieldOptional()
  columnId?: string;
}
