import { StringField } from '../../../decorators/field.decorators';
import { CommentMentionsInput } from './comment-mention.dto';

export class CreateCommentDto extends CommentMentionsInput {
  @StringField({ trim: true, minLength: 1, maxLength: 2000 })
  content!: string;
}
