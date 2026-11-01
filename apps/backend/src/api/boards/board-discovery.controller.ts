import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiProperty,
  ApiTags,
  ApiOkResponse,
  ApiExtraModels,
  getSchemaPath,
} from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { Expose } from 'class-transformer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { BoardResponseDto } from './dto/board-response.dto';
import { BOARD_BACKGROUNDS, BOARD_BACKGROUND_IDS } from './board-backgrounds';
import { BoardDiscoveryService } from './board-discovery.service';

class UpdateBackgroundDto {
  @IsIn(BOARD_BACKGROUND_IDS)
  @ApiProperty({ enum: BOARD_BACKGROUND_IDS })
  preset!: string;
}
class BoardUserStateDto {
  @Expose() @ApiProperty() isStarred!: boolean;
  @Expose()
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  lastViewedAt!: string | null;
}
class BoardBackgroundPresetDto {
  @Expose() @ApiProperty({ enum: BOARD_BACKGROUND_IDS }) id!: string;
  @Expose() @ApiProperty({ enum: ['color', 'photo'] }) kind!: string;
  @Expose() @ApiProperty() value!: string;
  @Expose() @ApiProperty({ enum: ['light', 'dark'] }) foreground!: string;
}

@ApiTags('board-discovery')
@UseGuards(JwtAuthGuard)
@Controller('boards')
export class BoardDiscoveryController {
  constructor(private readonly discovery: BoardDiscoveryService) {}

  @Get('background-presets')
  @ApiBearerToken()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(BoardBackgroundPresetDto)
  @ApiExtraModels(BoardBackgroundPresetDto)
  @ApiOkResponse({
    schema: {
      properties: {
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(BoardBackgroundPresetDto) },
        },
      },
    },
  })
  presets() {
    return BOARD_BACKGROUNDS;
  }

  @Get(':boardId/user-state')
  @ApiBearerToken()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(BoardUserStateDto)
  @ApiSuccess({ type: BoardUserStateDto })
  @ApiCommonErrors()
  state(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) id: string,
  ) {
    return this.discovery.state(user.userId, id);
  }

  @Put(':boardId/star')
  @HttpCode(200)
  @ApiBearerToken()
  @SerializeResponse(BoardUserStateDto)
  @ApiSuccess({ type: BoardUserStateDto })
  @ApiCommonErrors()
  star(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) id: string,
  ) {
    return this.discovery.setStar(user.userId, id, true);
  }

  @Delete(':boardId/star')
  @HttpCode(200)
  @ApiBearerToken()
  @SerializeResponse(BoardUserStateDto)
  @ApiSuccess({ type: BoardUserStateDto })
  @ApiCommonErrors()
  unstar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) id: string,
  ) {
    return this.discovery.setStar(user.userId, id, false);
  }

  @Post(':boardId/views')
  @HttpCode(200)
  @ApiBearerToken()
  @SerializeResponse(BoardUserStateDto)
  @ApiSuccess({ type: BoardUserStateDto })
  @ApiCommonErrors()
  view(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) id: string,
  ) {
    return this.discovery.view(user.userId, id);
  }

  @Patch(':boardId/background')
  @ApiBearerToken()
  @SerializeResponse(BoardResponseDto)
  @ApiSuccess({ type: BoardResponseDto })
  @ApiCommonErrors()
  background(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) id: string,
    @Body() input: UpdateBackgroundDto,
  ) {
    return this.discovery.background(user.userId, id, input.preset);
  }
}
