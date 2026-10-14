import { EnumField } from '../../../decorators/field.decorators';
import { BoardMemberRole } from '../../../common/enums/database-enums';

export class UpdateBoardMemberRoleDto {
  @EnumField(BoardMemberRole, { enumName: 'BoardMemberRole' })
  role!: BoardMemberRole;
}
