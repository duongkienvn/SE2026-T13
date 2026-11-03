import { ApiPropertyOptional } from '@nestjs/swagger';
import { PageQueryDto } from '../../../common/dto/page-query.dto';
import { EnumFieldOptional } from '../../../decorators/field.decorators';

export class ListNotificationsDto extends PageQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 }) declare page: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  declare limit: number;
  @EnumFieldOptional({ ALL: 'all', UNREAD: 'unread' })
  @ApiPropertyOptional({ enum: ['all', 'unread'], default: 'all' })
  filter: 'all' | 'unread' = 'all';
}
