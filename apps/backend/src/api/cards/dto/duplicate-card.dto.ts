import { UUIDFieldOptional } from '../../../decorators/field.decorators';

export class DuplicateCardDto {
  @UUIDFieldOptional({
    description:
      'Destination column in the same board; omitted keeps the source column',
  })
  columnId?: string;
}
