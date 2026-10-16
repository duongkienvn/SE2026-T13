import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiNoContent,
  ApiPaginated,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import {
  ResponseMessage,
  SerializeResponse,
} from '../../decorators/response.decorators';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { PaginatedResponse } from '../../common/dto/paginated-response';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ColumnsService } from './columns.service';
import { ColumnResponseDto } from './dto/column-response.dto';
import { CreateColumnDto } from './dto/create-column.dto';
import { MoveColumnDto } from './dto/move-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';

@ApiTags('columns')
@Controller('boards/:boardId/columns')
@UseGuards(JwtAuthGuard)
export class ColumnsController {
  constructor(private readonly columns: ColumnsService) {}

  @Get()
  @SerializeResponse(ColumnResponseDto)
  @ApiBearerToken()
  @ApiParam({ name: 'boardId', format: 'uuid' })
  @ApiPaginated(ColumnResponseDto, {
    summary: 'List columns for an authorized board member',
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
  ): Promise<PaginatedResponse<ColumnResponseDto>> {
    return this.columns.list(user.userId, boardId, query);
  }

  @Post()
  @SerializeResponse(ColumnResponseDto)
  @ResponseMessage('Column created')
  @ApiBearerToken()
  @ApiParam({ name: 'boardId', format: 'uuid' })
  @ApiSuccess({
    type: ColumnResponseDto,
    status: HttpStatus.CREATED,
    summary: 'Create a column in an active board',
  })
  @ApiCommonErrors([400, 401, 404, 409, 429, 500])
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body() input: CreateColumnDto,
  ): Promise<ColumnResponseDto> {
    return this.columns.create(user.userId, boardId, input);
  }

  @Patch(':columnId')
  @SerializeResponse(ColumnResponseDto)
  @ResponseMessage('Column renamed')
  @ApiBearerToken()
  @ApiParam({ name: 'boardId', format: 'uuid' })
  @ApiParam({ name: 'columnId', format: 'uuid' })
  @ApiSuccess({ type: ColumnResponseDto, summary: 'Rename a column' })
  @ApiCommonErrors([400, 401, 404, 409, 429, 500])
  rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
    @Body() input: UpdateColumnDto,
  ): Promise<ColumnResponseDto> {
    return this.columns.rename(user.userId, boardId, columnId, input);
  }

  @Patch(':columnId/move')
  @SerializeResponse(ColumnResponseDto)
  @ResponseMessage('Column moved')
  @ApiBearerToken()
  @ApiParam({ name: 'boardId', format: 'uuid' })
  @ApiParam({ name: 'columnId', format: 'uuid' })
  @ApiSuccess({ type: ColumnResponseDto, summary: 'Move a column' })
  @ApiCommonErrors([400, 401, 404, 409, 429, 500])
  move(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
    @Body() input: MoveColumnDto,
  ): Promise<ColumnResponseDto> {
    return this.columns.move(user.userId, boardId, columnId, input);
  }

  @Delete(':columnId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerToken()
  @ApiParam({ name: 'boardId', format: 'uuid' })
  @ApiParam({ name: 'columnId', format: 'uuid' })
  @ApiNoContent({ summary: 'Delete an empty column' })
  @ApiCommonErrors([400, 401, 404, 409, 429, 500])
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('columnId', ParseUUIDPipe) columnId: string,
  ): Promise<void> {
    await this.columns.remove(user.userId, boardId, columnId);
  }
}
