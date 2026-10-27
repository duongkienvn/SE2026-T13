import { StringFieldOptional } from '../../../decorators/field.decorators';

export class UpdateUserProfileDto {
  @StringFieldOptional({ trim: true, minLength: 2, maxLength: 80 })
  displayName?: string;
}
