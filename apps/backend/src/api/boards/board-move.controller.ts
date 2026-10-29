import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { UUIDField } from '../../decorators/field.decorators';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { BoardResponseDto } from './dto/board-response.dto';
import { BoardMoveService } from './board-move.service';

class MoveBoardDto {
  @UUIDField() destinationWorkspaceId!: string;
}

@ApiTags('boards')
@UseGuards(JwtAuthGuard)
@Controller('boards')
export class BoardMoveController {
  constructor(private readonly moves: BoardMoveService) {}

  @Post(':boardId/move-workspace')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiBearerToken()
  @ApiCommonErrors()
  @SerializeResponse(BoardResponseDto)
  @ApiSuccess({
    type: BoardResponseDto,
    summary: 'Move a Board as OWNER, resetting visibility to PRIVATE',
  })
  move(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) id: string,
    @Body() input: MoveBoardDto,
  ) {
    return this.moves.move(user.userId, id, input.destinationWorkspaceId);
  }
}
