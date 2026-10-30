import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiPaginated,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { WorkspaceApiService } from './workspace-api.service';
import { WorkspaceBoardsService } from './workspace-boards.service';
import { WorkspaceResponseDto } from './dto/workspace-response.dto';
import {
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
} from './dto/workspace-input.dto';
import { WorkspacePageQueryDto } from './dto/workspace-page-query.dto';
import { WorkspaceBoardsQueryDto } from './dto/workspace-boards-query.dto';
import { WorkspaceBoardResponseDto } from './dto/workspace-board-response.dto';
import { WorkspaceOverviewDto } from './dto/workspace-overview.dto';
import { WorkspaceActivityDto } from './dto/workspace-activity.dto';
import { WorkspaceActivityService } from './workspace-activity.service';

@ApiTags('workspaces')
@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspaceApiController {
  constructor(
    private readonly workspaces: WorkspaceApiService,
    private readonly boards: WorkspaceBoardsService,
    private readonly activity: WorkspaceActivityService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiBearerToken()
  @ApiCommonErrors([400, 401, 429, 500])
  @SerializeResponse(WorkspaceResponseDto)
  @ApiPaginated(WorkspaceResponseDto, {
    summary: 'List only joined Workspaces; ensure own Personal Workspace',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: WorkspacePageQueryDto,
  ) {
    return this.workspaces.list(user.userId, query);
  }

  @Get('personal')
  @Header('Cache-Control', 'no-store')
  @ApiBearerToken()
  @ApiCommonErrors([401, 409, 429, 500])
  @SerializeResponse(WorkspaceResponseDto)
  @ApiSuccess({
    type: WorkspaceResponseDto,
    summary: 'Ensure and read own Personal Workspace',
  })
  personal(@CurrentUser() user: AuthenticatedUser) {
    return this.workspaces.personal(user.userId);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiBearerToken()
  @ApiCommonErrors([400, 401, 409, 429, 500])
  @SerializeResponse(WorkspaceResponseDto)
  @ApiSuccess({
    type: WorkspaceResponseDto,
    status: 201,
    summary: 'Create Team Workspace and creator ADMIN atomically',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateWorkspaceDto,
  ) {
    return this.workspaces.create(user.userId, input);
  }

  @Get(':workspaceId/boards')
  @Header('Cache-Control', 'no-store')
  @ApiBearerToken()
  @ApiCommonErrors([400, 401, 404, 429, 500])
  @SerializeResponse(WorkspaceBoardResponseDto)
  @ApiPaginated(WorkspaceBoardResponseDto, {
    summary: 'List readable Boards as a Workspace Member',
  })
  listBoards(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: WorkspaceBoardsQueryDto,
  ) {
    return this.boards.list(user.userId, workspaceId, query);
  }

  @Get(':workspaceId/activity')
  @Header('Cache-Control', 'no-store')
  @ApiBearerToken()
  @ApiCommonErrors([400, 401, 404, 429, 500])
  @SerializeResponse(WorkspaceActivityDto)
  @ApiPaginated(WorkspaceActivityDto, {
    summary: 'List accessible Workspace activity',
  })
  activityList(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: WorkspacePageQueryDto,
  ) {
    return this.activity.list(user.userId, workspaceId, query);
  }

  @Get(':workspaceId/overview')
  @Header('Cache-Control', 'no-store')
  @ApiBearerToken()
  @ApiCommonErrors([400, 401, 404, 429, 500])
  @SerializeResponse(WorkspaceOverviewDto)
  @ApiSuccess({
    type: WorkspaceOverviewDto,
    summary: 'ACL-filtered Board counts and five recently updated Boards',
  })
  overview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    return this.boards.overview(user.userId, workspaceId);
  }

  @Get(':workspaceId')
  @Header('Cache-Control', 'no-store')
  @ApiBearerToken()
  @ApiCommonErrors([400, 401, 404, 429, 500])
  @SerializeResponse(WorkspaceResponseDto)
  @ApiSuccess({
    type: WorkspaceResponseDto,
    summary: 'Read Workspace metadata as a Workspace Member',
  })
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    return this.workspaces.detail(user.userId, workspaceId);
  }

  @Patch(':workspaceId')
  @Header('Cache-Control', 'no-store')
  @ApiBearerToken()
  @ApiCommonErrors([400, 401, 403, 404, 409, 429, 500])
  @SerializeResponse(WorkspaceResponseDto)
  @ApiSuccess({
    type: WorkspaceResponseDto,
    summary: 'Update only Workspace metadata as ADMIN',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() input: UpdateWorkspaceDto,
  ) {
    return this.workspaces.update(user.userId, workspaceId, input);
  }
}
