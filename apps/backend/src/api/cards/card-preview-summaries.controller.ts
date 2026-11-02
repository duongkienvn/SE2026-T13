import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CardsService } from './cards.service';
import { PreviewQueryDto } from './dto/preview-query.dto';

export class PreviewChecklistDto {
  @Expose() @ApiProperty() checkedItems!: number;
  @Expose() @ApiProperty() totalItems!: number;
}
export class CardPreviewSummaryDto {
  @Expose() @ApiProperty({ format: 'uuid' }) cardId!: string;
  @Expose()
  @ApiProperty({ type: [String], format: 'uuid' })
  labelIds!: string[];
  @Expose()
  @Type(() => PreviewChecklistDto)
  @ApiProperty({ type: PreviewChecklistDto })
  checklist!: PreviewChecklistDto;
  @Expose() @ApiProperty() attachmentCount!: number;
  @Expose() @ApiProperty() commentCount!: number;
}
export class CardPreviewSummariesDto {
  @Expose()
  @Type(() => CardPreviewSummaryDto)
  @ApiProperty({ type: [CardPreviewSummaryDto] })
  summaries!: CardPreviewSummaryDto[];
}
@ApiTags('cards')
@Controller('boards/:boardId/card-preview-summaries')
@UseGuards(JwtAuthGuard)
export class CardPreviewSummariesController {
  constructor(private readonly cards: CardsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(CardPreviewSummariesDto)
  @ApiBearerToken()
  @ApiQuery({
    name: 'cardIds',
    required: true,
    description: '1-100 unique comma-separated card UUIDs',
  })
  @ApiCommonErrors()
  @ApiSuccess({
    type: CardPreviewSummariesDto,
    summary: 'Read summaries for up to 100 active cards on a readable board',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Query() query: PreviewQueryDto,
  ): Promise<CardPreviewSummariesDto> {
    return this.cards.previewSummaries(user.userId, boardId, query.cardIds);
  }
}
