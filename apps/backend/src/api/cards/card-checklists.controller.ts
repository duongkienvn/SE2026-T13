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
import { ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiNoContent,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CardChecklistsService } from './card-checklists.service';
import {
  CardChecklistsResponseDto,
  CardChecklistSummaryDto,
  ChecklistResponseDto,
} from './dto/checklist-response.dto';
import {
  ChecklistReadQueryDto,
  ChecklistTitleDto,
  CreateChecklistItemDto,
  UpdateChecklistItemDto,
  MoveChecklistDto,
  MoveChecklistItemDto,
} from './dto/checklist-requests.dto';

@ApiTags('card-checklists')
@ApiParam({ name: 'boardId', format: 'uuid' })
@ApiParam({ name: 'cardId', format: 'uuid' })
@Controller('boards/:boardId/cards/:cardId/checklists')
@UseGuards(JwtAuthGuard)
export class CardChecklistsController {
  constructor(private readonly checklists: CardChecklistsService) {}

  @Get('')
  @ApiBearerToken()
  @ApiCommonErrors()
  @SerializeResponse(CardChecklistsResponseDto)
  @ApiSuccess({
    type: CardChecklistsResponseDto,
    summary: 'List ordered checklists and items with authoritative progress',
  })
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Query() _query: ChecklistReadQueryDto,
  ): Promise<CardChecklistsResponseDto> {
    void _query; // Validation rejects unsupported query fields.
    return this.checklists.list(user.userId, boardId, cardId);
  }

  @Get('summary')
  @ApiBearerToken()
  @ApiCommonErrors()
  @SerializeResponse(CardChecklistSummaryDto)
  @ApiSuccess({
    type: CardChecklistSummaryDto,
    summary: 'Read aggregate checklist progress without loading item contents',
  })
  @Header('Cache-Control', 'no-store')
  async summary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Query() _query: ChecklistReadQueryDto,
  ): Promise<CardChecklistSummaryDto> {
    void _query; // Validation rejects unsupported query fields.
    return (await this.checklists.summaries(user.userId, boardId, [cardId]))[0];
  }

  @Post('')
  @ApiBearerToken()
  @ApiCommonErrors()
  @SerializeResponse(ChecklistResponseDto)
  @ApiSuccess({
    type: ChecklistResponseDto,
    status: HttpStatus.CREATED,
    summary: 'Append a checklist (maximum 50 per Card)',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() input: ChecklistTitleDto,
  ): Promise<ChecklistResponseDto> {
    return this.checklists.create(user.userId, boardId, cardId, input);
  }

  @Patch(':checklistId')
  @ApiBearerToken()
  @ApiCommonErrors()
  @ApiParam({ name: 'checklistId', format: 'uuid' })
  @SerializeResponse(ChecklistResponseDto)
  @ApiSuccess({ type: ChecklistResponseDto, summary: 'Rename a checklist' })
  async rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('checklistId', ParseUUIDPipe) checklistId: string,
    @Body() input: ChecklistTitleDto,
  ): Promise<ChecklistResponseDto> {
    return this.checklists.rename(
      user.userId,
      boardId,
      cardId,
      checklistId,
      input,
    );
  }

  @Patch(':checklistId/move')
  @ApiBearerToken()
  @ApiCommonErrors()
  @ApiParam({ name: 'checklistId', format: 'uuid' })
  @SerializeResponse(ChecklistResponseDto)
  @ApiSuccess({
    type: ChecklistResponseDto,
    summary: 'Reorder a checklist within its Card',
  })
  async move(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('checklistId', ParseUUIDPipe) checklistId: string,
    @Body() input: MoveChecklistDto,
  ): Promise<ChecklistResponseDto> {
    return this.checklists.move(
      user.userId,
      boardId,
      cardId,
      checklistId,
      input.beforeChecklistId,
    );
  }

  @Delete(':checklistId')
  @ApiBearerToken()
  @ApiCommonErrors()
  @ApiParam({ name: 'checklistId', format: 'uuid' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContent({ summary: 'Delete a checklist and its items' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('checklistId', ParseUUIDPipe) checklistId: string,
  ): Promise<void> {
    return this.checklists.remove(user.userId, boardId, cardId, checklistId);
  }

  @Post(':checklistId/items')
  @ApiBearerToken()
  @ApiCommonErrors()
  @ApiParam({ name: 'checklistId', format: 'uuid' })
  @SerializeResponse(ChecklistResponseDto)
  @ApiSuccess({
    type: ChecklistResponseDto,
    status: HttpStatus.CREATED,
    summary:
      'Append an unchecked item (maximum 200 per checklist); return its complete checklist',
  })
  async addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('checklistId', ParseUUIDPipe) checklistId: string,
    @Body() input: CreateChecklistItemDto,
  ): Promise<ChecklistResponseDto> {
    return this.checklists.addItem(
      user.userId,
      boardId,
      cardId,
      checklistId,
      input,
    );
  }

  @Patch(':checklistId/items/:itemId')
  @ApiBearerToken()
  @ApiCommonErrors()
  @ApiParam({ name: 'checklistId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @SerializeResponse(ChecklistResponseDto)
  @ApiSuccess({
    type: ChecklistResponseDto,
    summary:
      'Set item text and/or checked state atomically; return its complete checklist',
  })
  async updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('checklistId', ParseUUIDPipe) checklistId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() input: UpdateChecklistItemDto,
  ): Promise<ChecklistResponseDto> {
    return this.checklists.updateItem(
      user.userId,
      boardId,
      cardId,
      checklistId,
      itemId,
      input,
    );
  }

  @Patch(':checklistId/items/:itemId/move')
  @ApiBearerToken()
  @ApiCommonErrors()
  @ApiParam({ name: 'checklistId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @SerializeResponse(ChecklistResponseDto)
  @ApiSuccess({
    type: ChecklistResponseDto,
    summary:
      'Reorder an item within its checklist; return its complete checklist',
  })
  async moveItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('checklistId', ParseUUIDPipe) checklistId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() input: MoveChecklistItemDto,
  ): Promise<ChecklistResponseDto> {
    return this.checklists.moveItem(
      user.userId,
      boardId,
      cardId,
      checklistId,
      itemId,
      input.beforeItemId,
    );
  }

  @Delete(':checklistId/items/:itemId')
  @ApiBearerToken()
  @ApiCommonErrors()
  @ApiParam({ name: 'checklistId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContent({ summary: 'Delete an item; refetch progress' })
  async removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('checklistId', ParseUUIDPipe) checklistId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<void> {
    return this.checklists.removeItem(
      user.userId,
      boardId,
      cardId,
      checklistId,
      itemId,
    );
  }
}
