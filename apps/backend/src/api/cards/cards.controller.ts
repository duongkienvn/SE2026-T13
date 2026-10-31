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
import { PaginatedResponse } from '../../common/dto/paginated-response';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CardsService } from './cards.service';
import { AssignCardDto } from './dto/assign-card.dto';
import { CardAssigneeResponseDto } from './dto/card-assignee-response.dto';
import { CardResponseDto } from './dto/card-response.dto';
import { CreateCardDto } from './dto/create-card.dto';
import { ListCardsDto } from './dto/list-cards.dto';
import { MoveCardDto } from './dto/move-card.dto';
import { UpdateCardDto } from './dto/update-card.dto';

@ApiTags('cards')
@ApiParam({ name: 'boardId', format: 'uuid' })
@Controller('boards/:boardId/cards')
@UseGuards(JwtAuthGuard)
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(CardResponseDto)
  @ApiBearerToken()
  @ApiPaginated(CardResponseDto, {
    summary:
      'List active (default) or archived cards; archived boards remain readable',
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
  @ApiQuery({ name: 'columnId', required: false, type: String, format: 'uuid' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'archived'],
    description: 'Default active; archived ordered by archivedAt DESC, id DESC',
  })
  @ApiCommonErrors()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Query() query: ListCardsDto,
  ): Promise<PaginatedResponse<CardResponseDto>> {
    return this.cards.list(user.userId, boardId, query);
  }

  @Get(':cardId')
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(CardResponseDto)
  @ApiBearerToken()
  @ApiParam({ name: 'cardId', format: 'uuid' })
  @ApiSuccess({
    type: CardResponseDto,
    summary: 'Read a card and its assignees, including archived cards',
  })
  @ApiCommonErrors()
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
  ): Promise<CardResponseDto> {
    return this.cards.get(user.userId, boardId, cardId);
  }

  @Post()
  @SerializeResponse(CardResponseDto)
  @ResponseMessage('Card created')
  @ApiBearerToken()
  @ApiSuccess({
    type: CardResponseDto,
    status: HttpStatus.CREATED,
    summary: 'Append a card to a column in an active board',
  })
  @ApiCommonErrors()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body() input: CreateCardDto,
  ): Promise<CardResponseDto> {
    return this.cards.create(user.userId, boardId, input);
  }

  @Patch(':cardId')
  @SerializeResponse(CardResponseDto)
  @ApiBearerToken()
  @ApiParam({ name: 'cardId', format: 'uuid' })
  @ApiSuccess({
    type: CardResponseDto,
    summary:
      'Partially update title, description, start or due instant; null clears nullable fields',
  })
  @ApiCommonErrors()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() input: UpdateCardDto,
  ): Promise<CardResponseDto> {
    return this.cards.update(user.userId, boardId, cardId, input);
  }

  @Post(':cardId/archive')
  @HttpCode(HttpStatus.OK)
  @SerializeResponse(CardResponseDto)
  @ApiBearerToken()
  @ApiParam({ name: 'cardId', format: 'uuid' })
  @ApiSuccess({
    type: CardResponseDto,
    summary: 'Archive an active card without removing assignments or comments',
  })
  @ApiCommonErrors()
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
  ): Promise<CardResponseDto> {
    return this.cards.archive(user.userId, boardId, cardId);
  }

  @Post(':cardId/restore')
  @HttpCode(HttpStatus.OK)
  @SerializeResponse(CardResponseDto)
  @ResponseMessage('Card restored')
  @ApiBearerToken()
  @ApiParam({ name: 'cardId', format: 'uuid' })
  @ApiSuccess({
    type: CardResponseDto,
    summary:
      'Restore an archived card to the end of its original column on an active board',
  })
  @ApiCommonErrors()
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
  ): Promise<CardResponseDto> {
    return this.cards.restore(user.userId, boardId, cardId);
  }

  @Patch(':cardId/move')
  @SerializeResponse(CardResponseDto)
  @ApiBearerToken()
  @ApiParam({ name: 'cardId', format: 'uuid' })
  @ApiSuccess({
    type: CardResponseDto,
    summary:
      'Move within the board before an active anchor, or append with null',
  })
  @ApiCommonErrors()
  move(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() input: MoveCardDto,
  ): Promise<CardResponseDto> {
    return this.cards.move(user.userId, boardId, cardId, input);
  }

  @Post(':cardId/assignees')
  @SerializeResponse(CardAssigneeResponseDto)
  @ApiBearerToken()
  @ApiParam({ name: 'cardId', format: 'uuid' })
  @ApiSuccess({
    type: CardAssigneeResponseDto,
    status: HttpStatus.CREATED,
    summary: 'Assign a current board member; duplicate assignments conflict',
  })
  @ApiCommonErrors()
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() input: AssignCardDto,
  ): Promise<CardAssigneeResponseDto> {
    return this.cards.assign(user.userId, boardId, cardId, input);
  }

  @Delete(':cardId/assignees/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerToken()
  @ApiParam({ name: 'cardId', format: 'uuid' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiNoContent({
    summary:
      'Remove only this card assignment; a missing assignment returns 404',
  })
  @ApiCommonErrors()
  unassign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.cards.unassign(user.userId, boardId, cardId, userId);
  }
}
