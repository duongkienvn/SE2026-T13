import { StringField } from '../../../decorators/field.decorators';

export class CreateCommentDto {
  @StringField({ trim: true, minLength: 1, maxLength: 2000 })
  content!: string;
}
