import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { WorkspacePoliciesService } from './workspace-policies.service';
import {
  UpdateWorkspacePolicyDto,
  WorkspacePolicyResponseDto,
} from './dto/workspace-policy.dto';

@ApiTags('workspaces')
@UseGuards(JwtAuthGuard)
@Controller('workspaces/:workspaceId/policies')
export class WorkspacePoliciesController {
  constructor(private readonly policies: WorkspacePoliciesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiBearerToken()
  @ApiCommonErrors()
  @SerializeResponse(WorkspacePolicyResponseDto)
  @ApiSuccess({
    type: WorkspacePolicyResponseDto,
    summary: 'Read Workspace policies',
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) id: string,
  ) {
    return this.policies.get(user.userId, id);
  }

  @Patch()
  @Header('Cache-Control', 'no-store')
  @ApiBearerToken()
  @ApiCommonErrors()
  @SerializeResponse(WorkspacePolicyResponseDto)
  @ApiSuccess({
    type: WorkspacePolicyResponseDto,
    summary: 'Update Workspace policies as ADMIN',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) id: string,
    @Body() input: UpdateWorkspacePolicyDto,
  ) {
    return this.policies.update(user.userId, id, input);
  }
}
