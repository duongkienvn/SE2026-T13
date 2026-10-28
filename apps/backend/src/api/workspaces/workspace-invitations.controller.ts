import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/constants/auth.constants';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiNoContent,
  ApiPaginated,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { WorkspaceInvitationsService } from './workspace-invitations.service';
import { WorkspaceInvitationIssuanceService } from './workspace-invitation-issuance.service';
import {
  CreateWorkspaceInvitationDto,
  WorkspaceInvitationResponseDto,
  WorkspaceInvitationsQueryDto,
} from './dto/workspace-invitations.dto';

@ApiTags('workspace-invitations')
@UseGuards(JwtAuthGuard)
@Controller('workspaces/:workspaceId/invitations')
export class WorkspaceInvitationsController {
  constructor(
    private readonly invitations: WorkspaceInvitationsService,
    private readonly issuance: WorkspaceInvitationIssuanceService,
  ) {}

  @Post()
  @ApiBearerToken()
  @ApiCommonErrors()
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(WorkspaceInvitationResponseDto)
  @ApiSuccess({
    type: WorkspaceInvitationResponseDto,
    status: 202,
    summary:
      'Request MEMBER invitation; inspect sendState for delivery availability',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() input: CreateWorkspaceInvitationDto,
  ) {
    return this.issuance.create(user.userId, workspaceId, input);
  }

  @Get()
  @ApiBearerToken()
  @ApiCommonErrors()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(WorkspaceInvitationResponseDto)
  @ApiPaginated(WorkspaceInvitationResponseDto, {
    summary: 'ADMIN-only invitation history without proof or hash',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: WorkspaceInvitationsQueryDto,
  ) {
    return this.invitations.list(user.userId, workspaceId, query);
  }

  @Delete(':invitationId')
  @ApiBearerToken()
  @ApiCommonErrors()
  @HttpCode(204)
  @ApiNoContent({ summary: 'Revoke an unconsumed invitation as ADMIN' })
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitations.revoke(user.userId, workspaceId, invitationId);
  }
}
