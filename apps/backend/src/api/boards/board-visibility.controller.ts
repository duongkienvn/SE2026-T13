import {
  Body,
  Controller,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { BoardVisibility } from '@kanban/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EnumField } from '../../decorators/field.decorators';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { BoardResponseDto } from './dto/board-response.dto';
import { BoardVisibilityService } from './board-visibility.service';

export class UpdateBoardVisibilityDto {
  @EnumField(BoardVisibility) visibility!: BoardVisibility;
}

@ApiTags('boards')
@Controller('boards')
@UseGuards(JwtAuthGuard)
export class BoardVisibilityController {
  constructor(private readonly visibility: BoardVisibilityService) {}

  @Patch(':boardId/visibility')
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(BoardResponseDto)
  @ApiBearerToken()
  @ApiParam({ name: 'boardId', format: 'uuid' })
  @ApiSuccess({
    type: BoardResponseDto,
    summary: 'Change active Board visibility as Board OWNER',
  })
  @ApiCommonErrors([400, 401, 403, 404, 409, 429, 500])
  change(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body() input: UpdateBoardVisibilityDto,
  ) {
    return this.visibility.change(user.userId, boardId, input.visibility);
  }
}
