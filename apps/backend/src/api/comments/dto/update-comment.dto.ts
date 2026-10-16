import { StringField } from '../../../decorators/field.decorators';

export class UpdateCommentDto {
  @StringField({ trim: true, minLength: 1, maxLength: 2000 })
  content!: string;
}
