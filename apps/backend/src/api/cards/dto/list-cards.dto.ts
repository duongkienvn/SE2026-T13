import { PageQueryDto } from '../../../common/dto/page-query.dto';
import {
  EnumFieldOptional,
  UUIDFieldOptional,
} from '../../../decorators/field.decorators';

export class ListCardsDto extends PageQueryDto {
  @EnumFieldOptional({ ACTIVE: 'active', ARCHIVED: 'archived' })
  status?: 'active' | 'archived';

  @UUIDFieldOptional()
  columnId?: string;
}
