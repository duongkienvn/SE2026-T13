import { ApiProperty } from '@nestjs/swagger';
import { UUIDField } from '../../../decorators/field.decorators';

export class MoveColumnDto {
  @UUIDField({ nullable: true })
  @ApiProperty({ format: 'uuid', nullable: true })
  beforeColumnId!: string | null;
}
