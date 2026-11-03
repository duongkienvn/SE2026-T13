import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { MyTasksResponse } from '@kanban/shared';
import { apiSuccess } from '../../common/dto/api-success';
import { toResponseDto } from '../../common/dto/to-response-dto';
import {
  ApiSuccessEnvelopeDto,
  PaginationMetaDto,
} from '../../common/dto/api-response.dto';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { ProductivityService } from './productivity.service';
import { ListTasksDto } from './dto/list-tasks.dto';
import {
  HomeDashboardDto,
  TaskCardSummaryDto,
  TaskGroupCountsDto,
} from './dto/productivity-response.dto';

@ApiTags('productivity')
@Controller('users/me')
@UseGuards(JwtAuthGuard)
export class ProductivityController {
  constructor(private readonly productivity: ProductivityService) {}

  @Get('tasks')
  @Header('Cache-Control', 'no-store')
  @ApiBearerToken()
  @ApiOperation({
    summary: 'Read assigned active Cards across currently authorized Boards',
    description:
      'Calendar-day groups use the persisted user timezone. groupCounts apply non-group filters before the selected group. ALL sorts by group priority, then the requested sort, then Card ID.',
  })
  @ApiExtraModels(
    ApiSuccessEnvelopeDto,
    PaginationMetaDto,
    TaskCardSummaryDto,
    TaskGroupCountsDto,
  )
  @ApiResponse({
    status: 200,
    schema: {
      allOf: [
        { $ref: getSchemaPath(ApiSuccessEnvelopeDto) },
        {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { $ref: getSchemaPath(TaskCardSummaryDto) },
            },
            meta: { $ref: getSchemaPath(PaginationMetaDto) },
            groupCounts: { $ref: getSchemaPath(TaskGroupCountsDto) },
          },
          required: ['data', 'meta', 'groupCounts'],
        },
      ],
    },
  })
  @ApiCommonErrors([400, 401, 429, 500])
  async tasks(
    @CurrentUser() user: AuthenticatedUser,
    @Query() input: ListTasksDto,
  ): Promise<MyTasksResponse> {
    const result = await this.productivity.tasks(user.userId, input);
    // The explicit envelope preserves the existing flat pagination shape while
    // adding groupCounts. Explicit responses must serialize every public field here.
    return Object.assign(
      apiSuccess(
        result.data.map((row) => toResponseDto(TaskCardSummaryDto, row)),
      ),
      {
        meta: result.meta,
        groupCounts: toResponseDto(TaskGroupCountsDto, result.groupCounts),
      },
    );
  }

  @Get('home')
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(HomeDashboardDto)
  @ApiBearerToken()
  @ApiSuccess({
    type: HomeDashboardDto,
    summary:
      'Read authorized personal Home summary, Up Next, stars and recorded visits',
  })
  @ApiCommonErrors([401, 429, 500])
  home(@CurrentUser() user: AuthenticatedUser): Promise<HomeDashboardDto> {
    return this.productivity.home(user.userId);
  }
}
