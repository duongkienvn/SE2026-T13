import { UUIDField } from '../../../decorators/field.decorators';

export class AssignCardDto {
  @UUIDField()
  userId!: string;
}
