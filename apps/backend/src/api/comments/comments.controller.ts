import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
import type { PaginatedResponse } from '../../common/dto/paginated-response';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CommentsService } from './comments.service';
import { CommentResponseDto } from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

@ApiTags('comments')
@ApiParam({ name: 'boardId', format: 'uuid' })
@ApiParam({ name: 'cardId', format: 'uuid' })
@Controller('boards/:boardId/cards/:cardId/comments')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(CommentResponseDto)
  @ApiBearerToken()
  @ApiPaginated(CommentResponseDto, {
    summary: 'List active comments on a card; archived cards remain readable',
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
  @ApiCommonErrors()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Query() query: PageQueryDto,
  ): Promise<PaginatedResponse<CommentResponseDto>> {
    return this.comments.list(user.userId, boardId, cardId, query);
  }

  @Post()
  @SerializeResponse(CommentResponseDto)
  @ResponseMessage('Comment created')
  @ApiBearerToken()
  @ApiSuccess({
    type: CommentResponseDto,
    status: HttpStatus.CREATED,
    summary: 'Create a comment on an active card',
  })
  @ApiCommonErrors()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() input: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    return this.comments.create(user.userId, boardId, cardId, input);
  }

  @Patch(':commentId')
  @SerializeResponse(CommentResponseDto)
  @ApiBearerToken()
  @ApiParam({ name: 'commentId', format: 'uuid' })
  @ApiSuccess({
    type: CommentResponseDto,
    summary: 'Edit the authenticated user’s own comment',
  })
  @ApiCommonErrors()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() input: UpdateCommentDto,
  ): Promise<CommentResponseDto> {
    return this.comments.update(user.userId, boardId, cardId, commentId, input);
  }

  @Delete(':commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerToken()
  @ApiParam({ name: 'commentId', format: 'uuid' })
  @ApiNoContent({ summary: 'Soft-delete the authenticated user’s own comment' })
  @ApiCommonErrors()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ): Promise<void> {
    return this.comments.remove(user.userId, boardId, cardId, commentId);
  }
}
