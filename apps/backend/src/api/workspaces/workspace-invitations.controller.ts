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
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
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
import { WorkspaceInvitationDeclineGuard } from './workspace-invitation-decline.guard';
import {
  AcceptWorkspaceInvitationDto,
  DeclineWorkspaceInvitationDto,
  CreateWorkspaceInvitationDto,
  WorkspaceInvitationResponseDto,
  WorkspaceInvitationsQueryDto,
} from './dto/workspace-invitations.dto';
import { WorkspaceMemberResponseDto } from './dto/workspace-members.dto';

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

@ApiTags('workspace-invitations')
@Controller('workspace-invitations')
export class WorkspaceInvitationAcceptanceController {
  constructor(private readonly invitations: WorkspaceInvitationsService) {}

  @Post('accept')
  @UseGuards(JwtAuthGuard)
  @ApiBearerToken()
  @ApiCommonErrors([400, 401, 403, 409, 410, 429, 500])
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @SerializeResponse(WorkspaceMemberResponseDto)
  @ApiSuccess({
    type: WorkspaceMemberResponseDto,
    summary:
      'Consume delivered proof for matching verified authenticated email',
  })
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: AcceptWorkspaceInvitationDto,
  ) {
    return this.invitations.accept(user.userId, input.proof);
  }

  @Post('decline')
  @UseGuards(WorkspaceInvitationDeclineGuard)
  @ApiBearerToken()
  @ApiCommonErrors([400, 401, 403, 409, 410, 429, 500])
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiNoContent({
    summary:
      'Decline a delivered proof as its matching verified recipient; never creates membership',
  })
  decline(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: DeclineWorkspaceInvitationDto,
  ) {
    return this.invitations.decline(user.userId, input.proof);
  }
}
