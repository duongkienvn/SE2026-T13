import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { UserPreferencesResponseDto } from './dto/user-preferences-response.dto';
import { UserPreferencesService } from './user-preferences.service';
import { UserPreferencesBodyGuard } from './user-preferences-body.guard';

@ApiTags('users')
@Controller('users/me/preferences')
@UseGuards(JwtAuthGuard)
export class UserPreferencesController {
  constructor(private readonly preferences: UserPreferencesService) {}

  @Get()
  @SerializeResponse(UserPreferencesResponseDto)
  @ApiBearerToken()
  @ApiSuccess({
    type: UserPreferencesResponseDto,
    summary: 'Read account preferences; defaults do not create a row',
  })
  @ApiCommonErrors([401, 404, 429, 500])
  get(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserPreferencesResponseDto> {
    return this.preferences.get(user.userId);
  }

  @Patch()
  @UseGuards(UserPreferencesBodyGuard)
  @SerializeResponse(UserPreferencesResponseDto)
  @ResponseMessage('Preferences updated')
  @ApiBearerToken()
  @ApiSuccess({
    type: UserPreferencesResponseDto,
    summary:
      'Save 1–4 preferences; omitted fields remain unchanged, null is invalid',
  })
  @ApiCommonErrors([400, 401, 404, 429, 500])
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: UpdateUserPreferencesDto,
  ): Promise<UserPreferencesResponseDto> {
    return this.preferences.update(user.userId, input);
  }
}
