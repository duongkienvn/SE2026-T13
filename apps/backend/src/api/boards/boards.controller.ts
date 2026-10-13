import {
  Body,
  Controller,
  Get,
  HttpStatus,
  HttpCode,
  Post,
  Query,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BoardsService } from './boards.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiSuccess,
  ApiPaginated,
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { CreateBoardDto } from './dto/create-board.dto';
import { BoardResponseDto } from './dto/board-response.dto';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { PaginatedResponse } from '../../common/dto/paginated-response';
import { ApiQuery } from '@nestjs/swagger';
import { UpdateBoardDto } from './dto/update-board.dto';
import { ResponseMessage } from '../../decorators/response.decorators';

@ApiTags('boards')
@Controller('boards')
@UseGuards(JwtAuthGuard)
export class BoardsController {
  constructor(private readonly boardsService: BoardsService) {}

  @Post(':boardId/archive')
  @HttpCode(HttpStatus.OK)
  @SerializeResponse(BoardResponseDto)
  @ResponseMessage('Board archived')
  @ApiBearerToken()
  @ApiParam({ name: 'boardId', format: 'uuid' })
  @ApiSuccess({
    type: BoardResponseDto,
    summary: 'Archive an active board as OWNER',
  })
  @ApiCommonErrors([400, 401, 403, 404, 409, 429, 500])
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
  ): Promise<BoardResponseDto> {
    return this.boardsService.archive(user.userId, boardId);
  }

  @Patch(':boardId')
  @SerializeResponse(BoardResponseDto)
  @ResponseMessage('Board updated')
  @ApiBearerToken()
  @ApiParam({ name: 'boardId', format: 'uuid' })
  @ApiSuccess({
    type: BoardResponseDto,
    summary: 'Update an active board as OWNER',
  })
  @ApiCommonErrors([400, 401, 403, 404, 409, 429, 500])
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body() input: UpdateBoardDto,
  ): Promise<BoardResponseDto> {
    return this.boardsService.update(user.userId, boardId, input);
  }

  @Get(':boardId')
  @SerializeResponse(BoardResponseDto)
  @ApiBearerToken()
  @ApiParam({ name: 'boardId', format: 'uuid' })
  @ApiSuccess({
    type: BoardResponseDto,
    summary: 'Get a board as OWNER or MEMBER, including archived boards',
  })
  @ApiCommonErrors([400, 401, 404, 429, 500])
  getDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
  ): Promise<BoardResponseDto> {
    return this.boardsService.getDetail(user.userId, boardId);
  }

  @Get()
  @SerializeResponse(BoardResponseDto)
  @ApiBearerToken()
  @ApiPaginated(BoardResponseDto, {
    summary: 'List active boards for the authenticated member',
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
  @ApiCommonErrors([400, 401, 429, 500])
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PageQueryDto,
  ): Promise<PaginatedResponse<BoardResponseDto>> {
    return this.boardsService.list(user.userId, query);
  }

  @Post()
  @SerializeResponse(BoardResponseDto)
  @ApiBearerToken()
  @ApiSuccess({
    type: BoardResponseDto,
    status: HttpStatus.CREATED,
    summary: 'Create a board with an OWNER membership',
  })
  @ApiCommonErrors([400, 401, 409, 429, 500])
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateBoardDto,
  ): Promise<BoardResponseDto> {
    return this.boardsService.create(user.userId, input);
  }
}
