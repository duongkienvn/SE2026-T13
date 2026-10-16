import { StringField } from '../../../decorators/field.decorators';

export class UpdateColumnDto {
  @StringField({ trim: true, minLength: 1, maxLength: 120 })
  name!: string;
}
