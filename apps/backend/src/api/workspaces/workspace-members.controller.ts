import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
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
  ApiPaginated,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { WorkspaceMembersService } from './workspace-members.service';
import {
  UpdateWorkspaceMemberDto,
  WorkspaceMemberResponseDto,
  WorkspaceMembersQueryDto,
} from './dto/workspace-members.dto';

@ApiTags('workspace-members')
@UseGuards(JwtAuthGuard)
@Controller('workspaces/:workspaceId')
export class WorkspaceMembersController {
  constructor(private readonly members: WorkspaceMembersService) {}

  @Get('members')
  @ApiBearerToken()
  @ApiCommonErrors()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(WorkspaceMemberResponseDto)
  @ApiPaginated(WorkspaceMemberResponseDto, {
    summary: 'List Workspace members without email or Board grants',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: WorkspaceMembersQueryDto,
  ) {
    return this.members.list(user.userId, workspaceId, query);
  }

  @Patch('members/:userId')
  @ApiBearerToken()
  @ApiCommonErrors()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(WorkspaceMemberResponseDto)
  @ApiSuccess({
    type: WorkspaceMemberResponseDto,
    summary: 'Change another Team member role as ADMIN',
  })
  changeRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() input: UpdateWorkspaceMemberDto,
  ) {
    return this.members.changeRole(
      user.userId,
      workspaceId,
      userId,
      input.role,
    );
  }
}
