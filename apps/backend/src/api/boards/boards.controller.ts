import { Body, Controller, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BoardsService } from './boards.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import { SerializeResponse } from '../../decorators/response.decorators';
import { CreateBoardDto } from './dto/create-board.dto';
import { BoardResponseDto } from './dto/board-response.dto';

@ApiTags('boards')
@Controller('boards')
@UseGuards(JwtAuthGuard)
export class BoardsController {
  constructor(private readonly boardsService: BoardsService) {}

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
