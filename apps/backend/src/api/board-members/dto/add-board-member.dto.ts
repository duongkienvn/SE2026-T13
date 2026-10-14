import { EmailField } from '../../../decorators/field.decorators';

export class AddBoardMemberDto {
  @EmailField({ trim: true, maxLength: 320 })
  email!: string;
}
