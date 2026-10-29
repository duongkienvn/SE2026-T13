import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { IsBoolean, ValidateIf } from 'class-validator';

export class UpdateWorkspacePolicyDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  @ApiProperty({ required: false })
  boardCreationAdminOnly?: boolean;
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  @ApiProperty({ required: false })
  boardInvitesEnabled?: boolean;
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  @ApiProperty({ required: false })
  boardMembershipChangesEnabled?: boolean;
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  @ApiProperty({ required: false })
  boardVisibilityChangesEnabled?: boolean;
}

export class WorkspacePolicyResponseDto {
  @Expose() @ApiProperty() boardCreationAdminOnly!: boolean;
  @Expose() @ApiProperty() boardInvitesEnabled!: boolean;
  @Expose() @ApiProperty() boardMembershipChangesEnabled!: boolean;
  @Expose() @ApiProperty() boardVisibilityChangesEnabled!: boolean;
  @Expose() @ApiProperty() canManagePolicies!: boolean;
  @Expose() @ApiProperty() canCreateBoards!: boolean;
}
