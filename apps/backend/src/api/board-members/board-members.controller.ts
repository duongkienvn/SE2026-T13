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
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { PaginatedResponse } from '../../common/dto/paginated-response';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AddBoardMemberDto } from './dto/add-board-member.dto';
import { BoardMemberResponseDto } from './dto/board-member-response.dto';
import { UpdateBoardMemberRoleDto } from './dto/update-board-member-role.dto';
import { BoardMembersService } from './board-members.service';

@ApiTags('board-members')
@Controller('boards/:boardId/members')
@UseGuards(JwtAuthGuard)
export class BoardMembersController {
  constructor(private readonly boardMembers: BoardMembersService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @SerializeResponse(BoardMemberResponseDto)
  @ApiBearerToken()
  @ApiParam({ name: 'boardId', format: 'uuid' })
  @ApiPaginated(BoardMemberResponseDto, {
    summary: 'List board members for an authorized member',
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
  @ApiCommonErrors([400, 401, 404, 429, 500])
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Query() query: PageQueryDto,
  ): Promise<PaginatedResponse<BoardMemberResponseDto>> {
    return this.boardMembers.list(user.userId, boardId, query);
  }

  @Post()
  @SerializeResponse(BoardMemberResponseDto)
  @ResponseMessage('Board member added')
  @ApiBearerToken()
  @ApiParam({ name: 'boardId', format: 'uuid' })
  @ApiSuccess({
    type: BoardMemberResponseDto,
    status: HttpStatus.CREATED,
    summary: 'Add a registered user to a board',
  })
  @ApiCommonErrors([400, 401, 404, 409, 429, 500])
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Body() input: AddBoardMemberDto,
  ): Promise<BoardMemberResponseDto> {
    return this.boardMembers.add(user.userId, boardId, input);
  }

  @Patch(':userId')
  @SerializeResponse(BoardMemberResponseDto)
  @ResponseMessage('Board member role updated')
  @ApiBearerToken()
  @ApiParam({ name: 'boardId', format: 'uuid' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiSuccess({
    type: BoardMemberResponseDto,
    summary: 'Update a board member role',
  })
  @ApiCommonErrors([400, 401, 403, 404, 409, 429, 500])
  updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() input: UpdateBoardMemberRoleDto,
  ): Promise<BoardMemberResponseDto> {
    return this.boardMembers.updateRole(
      user.userId,
      boardId,
      targetUserId,
      input,
    );
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerToken()
  @ApiParam({ name: 'boardId', format: 'uuid' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiNoContent({ summary: 'Remove a member and clear board card assignments' })
  @ApiCommonErrors([400, 401, 403, 404, 409, 429, 500])
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('boardId', ParseUUIDPipe) boardId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ): Promise<void> {
    await this.boardMembers.remove(user.userId, boardId, targetUserId);
  }
}
