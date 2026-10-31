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
import { SerializeResponse } from '../../decorators/response.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { PaginatedResponse } from '../../common/dto/paginated-response';
import { LabelsService } from './labels.service';
import {
  CardLabelsResponseDto,
  LabelResponseDto,
} from './dto/label-response.dto';
import {
  AssignLabelDto,
  CardLabelsQueryDto,
  CreateLabelDto,
  UpdateLabelDto,
} from './dto/label-requests.dto';

@ApiTags('labels')
@ApiParam({ name: 'boardId', format: 'uuid' })
@Controller('boards/:boardId/labels')
@UseGuards(JwtAuthGuard)
export class BoardLabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Get('')
  @ApiBearerToken()
  @ApiCommonErrors()
  @SerializeResponse(LabelResponseDto)
  @ApiPaginated(LabelResponseDto, {
    summary: 'List Board catalog ordered by lowercase name then UUID',
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
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Query() query: PageQueryDto,
  ): Promise<PaginatedResponse<LabelResponseDto>> {
    return this.labels.list(user.userId, boardId, query);
  }

  @Post('')
  @ApiBearerToken()
  @ApiCommonErrors()
  @SerializeResponse(LabelResponseDto)
  @ApiSuccess({
    type: LabelResponseDto,
    status: HttpStatus.CREATED,
    summary: 'Create a Board label; case-insensitive name uniqueness',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body() input: CreateLabelDto,
  ): Promise<LabelResponseDto> {
    return this.labels.create(user.userId, boardId, input);
  }

  @Patch(':labelId')
  @ApiBearerToken()
  @ApiCommonErrors()
  @ApiParam({ name: 'labelId', format: 'uuid' })
  @SerializeResponse(LabelResponseDto)
  @ApiSuccess({
    type: LabelResponseDto,
    summary: 'Rename or recolor a label; omission preserves, null rejected',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
    @Body() input: UpdateLabelDto,
  ): Promise<LabelResponseDto> {
    return this.labels.update(user.userId, boardId, labelId, input);
  }

  @Delete(':labelId')
  @ApiBearerToken()
  @ApiCommonErrors()
  @ApiParam({ name: 'labelId', format: 'uuid' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContent({
    summary: 'Delete a Board label and all its Card associations',
  })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
  ): Promise<void> {
    return this.labels.remove(user.userId, boardId, labelId);
  }
}

@ApiTags('labels')
@ApiParam({ name: 'boardId', format: 'uuid' })
@Controller('boards/:boardId/cards/:cardId/labels')
@UseGuards(JwtAuthGuard)
export class CardLabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Get('')
  @ApiBearerToken()
  @ApiCommonErrors()
  @ApiParam({ name: 'cardId', format: 'uuid' })
  @SerializeResponse(CardLabelsResponseDto)
  @ApiSuccess({
    type: CardLabelsResponseDto,
    summary: 'Read ordered labels on an active or archived Card',
  })
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Query() query: CardLabelsQueryDto,
  ): Promise<CardLabelsResponseDto> {
    void query; // Validate and reject unsupported query fields.
    return this.labels.cardLabels(user.userId, boardId, cardId);
  }

  @Post('')
  @ApiBearerToken()
  @ApiCommonErrors()
  @ApiParam({ name: 'cardId', format: 'uuid' })
  @SerializeResponse(CardLabelsResponseDto)
  @ApiSuccess({
    type: CardLabelsResponseDto,
    status: HttpStatus.CREATED,
    summary: 'Assign an existing label from this Board',
  })
  async assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body() input: AssignLabelDto,
  ): Promise<CardLabelsResponseDto> {
    return this.labels.assign(user.userId, boardId, cardId, input.labelId);
  }

  @Delete(':labelId')
  @ApiBearerToken()
  @ApiCommonErrors()
  @ApiParam({ name: 'cardId', format: 'uuid' })
  @ApiParam({ name: 'labelId', format: 'uuid' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContent({ summary: 'Unassign a label from an active Card' })
  async unassign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
  ): Promise<void> {
    return this.labels.unassign(user.userId, boardId, cardId, labelId);
  }
}
