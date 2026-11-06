import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { Matches } from 'class-validator';
import type {
  RemoveStarterBoardRequest,
  StarterBoardRemovalPreview,
} from '@kanban/shared';
import { StringField } from '../../decorators/field.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiSuccess,
  ApiNoContent,
} from '../../decorators/swagger-response.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { StarterBoardRemovalService } from './starter-board-removal.service';

export class RemoveStarterBoardDto implements RemoveStarterBoardRequest {
  @StringField({ minLength: 64, maxLength: 64 })
  @Matches(/^[0-9a-f]{64}$/)
  version!: string;
  @StringField({ maxLength: 40 }) confirmation!: string;
}
class StarterBoardRemovalPreviewDto implements StarterBoardRemovalPreview {
  @Expose() @ApiProperty() boardName!: string;
  @Expose() @ApiProperty() isCustomized!: boolean;
  @Expose() @ApiProperty() version!: string;
  @Expose()
  @ApiProperty({ enum: ['REMOVE SAMPLE BOARD', 'DELETE MY CUSTOMIZED BOARD'] })
  confirmation!: StarterBoardRemovalPreview['confirmation'];
}
@ApiTags('boards')
@UseGuards(JwtAuthGuard)
@Controller('boards/:boardId/sample-removal')
export class StarterBoardRemovalController {
  constructor(private readonly removal: StarterBoardRemovalService) {}
  @Get()
  @ApiBearerToken()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(StarterBoardRemovalPreviewDto)
  @ApiSuccess({
    type: StarterBoardRemovalPreviewDto,
    summary: 'Review removal of your authentic sample board as sole OWNER',
  })
  @ApiCommonErrors([400, 401, 403, 404, 409, 429, 500])
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
  ) {
    return this.removal.preview(user.userId, boardId);
  }
  @Delete()
  @ApiBearerToken()
  @HttpCode(204)
  @ApiNoContent({
    summary:
      'Permanently remove an eligible sample board after fresh confirmation',
  })
  @ApiCommonErrors([400, 401, 403, 404, 409, 429, 500])
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body() input: RemoveStarterBoardDto,
  ) {
    return this.removal.remove(user.userId, boardId, input);
  }
}
