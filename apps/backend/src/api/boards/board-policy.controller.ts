import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { BoardMemberRole } from '../../common/enums/database-enums';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BoardAuthorizationService } from '../board-members/board-authorization.service';
import { BoardPolicyService } from './board-policy.service';

class BoardPolicyCapabilitiesDto {
  @Expose() @ApiProperty() canInviteMembers!: boolean;
  @Expose() @ApiProperty() canChangeMembership!: boolean;
  @Expose() @ApiProperty() canChangeVisibility!: boolean;
}

@ApiTags('boards')
@UseGuards(JwtAuthGuard)
@Controller('boards')
export class BoardPolicyController {
  constructor(
    private readonly authorization: BoardAuthorizationService,
    private readonly policies: BoardPolicyService,
  ) {}

  @Get(':boardId/policy-capabilities')
  @Header('Cache-Control', 'no-store')
  @ApiBearerToken()
  @ApiCommonErrors()
  @SerializeResponse(BoardPolicyCapabilitiesDto)
  @ApiSuccess({
    type: BoardPolicyCapabilitiesDto,
    summary: 'Read effective Board policy capabilities',
  })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
  ) {
    const access = await this.authorization.requireRead(user.userId, boardId);
    const owner =
      access.member?.role === BoardMemberRole.OWNER && !access.board.isArchived;
    return this.policies.capabilities(access.board.workspaceId, owner);
  }
}
