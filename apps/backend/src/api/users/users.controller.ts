import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerToken,
  ApiCommonErrors,
  ApiSuccess,
} from '../../decorators/swagger-response.decorators';
import {
  ResponseMessage,
  SerializeResponse,
} from '../../decorators/response.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/constants/auth.constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @SerializeResponse(UserResponseDto)
  @ApiBearerToken()
  @ApiSuccess({ type: UserResponseDto, summary: 'Get the authenticated user' })
  @ApiCommonErrors([401, 404, 429, 500])
  getMe(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    return this.usersService.getCurrentUser(currentUser.userId);
  }

  @Patch('me')
  @SerializeResponse(UserResponseDto)
  @ResponseMessage('Profile updated')
  @ApiBearerToken()
  @ApiSuccess({
    type: UserResponseDto,
    summary: 'Update the authenticated user profile',
  })
  @ApiCommonErrors([400, 401, 404, 429, 500])
  updateMe(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() input: UpdateUserProfileDto,
  ): Promise<UserResponseDto> {
    return this.usersService.updateCurrentUser(currentUser.userId, input);
  }
}
