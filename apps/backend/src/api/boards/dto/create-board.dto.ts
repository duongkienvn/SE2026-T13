import {
  StringField,
  StringFieldOptional,
} from '../../../decorators/field.decorators';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBoardDto {
  @StringField({ trim: true, minLength: 1, maxLength: 120 })
  @ApiProperty({ minLength: 1, maxLength: 120 })
  name!: string;

  @StringFieldOptional({ nullable: true, minLength: 0, maxLength: 2000 })
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  description?: string | null;
}
