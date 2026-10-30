import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
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
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { WorkspaceGuestsService } from './workspace-guests.service';
import {
  WorkspaceGuestResponseDto,
  WorkspaceGuestsQueryDto,
} from './dto/workspace-guests.dto';

@ApiTags('workspace-guests')
@UseGuards(JwtAuthGuard)
@Controller('workspaces/:workspaceId/guests')
export class WorkspaceGuestsController {
  constructor(private readonly guests: WorkspaceGuestsService) {}

  @Get()
  @ApiBearerToken()
  @ApiCommonErrors()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(WorkspaceGuestResponseDto)
  @ApiPaginated(WorkspaceGuestResponseDto, {
    summary: 'List Guests scoped to explicitly joined Board rosters',
    description:
      'Requires Workspace membership (otherwise access-safe 404). Only explicit Board membership permits roster inspection, including archived Boards. Workspace ADMIN or WORKSPACE_VISIBLE read-only access alone never qualifies. Distinct users sorted by displayName ASC, id ASC; display-name-only literal search. Totals and visibleBoardCount cover only eligible associations, never the complete Workspace directory.',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: WorkspaceGuestsQueryDto,
  ) {
    return this.guests.list(user.userId, workspaceId, query);
  }
}
