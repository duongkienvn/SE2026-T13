import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiPaginated,
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { PaginatedResponse } from '../../common/dto/paginated-response';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ActivityResponseDto } from './dto/activity-response.dto';
import { ActivitiesService } from './activities.service';

@ApiTags('activities')
@ApiParam({ name: 'boardId', format: 'uuid' })
@Controller('boards/:boardId/activities')
@UseGuards(JwtAuthGuard)
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  @SerializeResponse(ActivityResponseDto)
  @ApiBearerToken()
  @ApiPaginated(ActivityResponseDto, {
    summary: 'List board activity for an authenticated member',
    description:
      'Returns structured activity data newest first. Archived boards remain readable.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    schema: { minimum: 1, default: 1 },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    schema: { minimum: 1, maximum: 100, default: 20 },
  })
  @ApiCommonErrors([400, 401, 404, 429, 500])
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Query() query: PageQueryDto,
  ): Promise<PaginatedResponse<ActivityResponseDto>> {
    return this.activities.list(user.userId, boardId, query);
  }
}
