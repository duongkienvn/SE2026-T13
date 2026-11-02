import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';
import { csvIds } from './list-cards.dto';

export class PreviewQueryDto {
  @Transform(({ value }: { value: unknown }) => csvIds(value))
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  cardIds!: string[];
}
